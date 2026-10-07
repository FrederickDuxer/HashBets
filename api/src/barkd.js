import { config } from './config.js';

async function barkd(pathname, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (config.barkdToken) headers.Authorization = `Bearer ${config.barkdToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${config.barkdUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || text || res.statusText;
    throw new Error(`barkd ${method} ${pathname} → ${res.status}: ${msg}`);
  }
  return data;
}

function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

export async function createLightningInvoice({ amountSats, description }) {
  const data = await barkd('/api/v1/lightning/receives/invoice', {
    method: 'POST',
    body: {
      amountSat: amountSats,
      amount_sat: amountSats,
      description,
    },
  });

  const invoice = pick(data, 'invoice', 'bolt11', 'paymentRequest', 'payment_request');
  const paymentId = pick(data, 'paymentHash', 'payment_hash', 'id', 'identifier') || invoice;
  if (!invoice) throw new Error('barkd invoice response missing invoice string');
  return { paymentId, paymentRequest: invoice, invoice };
}

export async function createArkReceiveAddress() {
  const data = await barkd('/api/v1/wallet/addresses/next', { method: 'POST' });
  const address = pick(data, 'address', 'arkAddress', 'ark_address');
  if (!address) throw new Error('barkd address response missing address');
  return { paymentId: address, address };
}

export async function isIncomingPaid({ payRail, paymentId, amountSats, arkAddress }) {
  if (payRail === 'lightning') {
    const data = await barkd(`/api/v1/lightning/receives/${encodeURIComponent(paymentId)}`);
    const status = String(pick(data, 'status', 'state', 'receiveStatus') || '').toLowerCase();
    if (['paid', 'settled', 'claimed', 'complete', 'completed', 'success'].includes(status)) {
      return true;
    }
    if (pick(data, 'paid', 'settled', 'isPaid', 'is_paid') === true) return true;
    return false;
  }

  // Ark: sync then look for an incoming movement matching amount (+ address when present)
  try {
    await barkd('/api/v1/wallet/sync', { method: 'POST', body: {} });
  } catch {
    // sync may require empty body or no body
    try {
      await barkd('/api/v1/wallet/sync', { method: 'POST' });
    } catch {
      /* continue with history */
    }
  }

  let movements = [];
  try {
    const hist = await barkd('/api/v1/wallet/movements');
    movements = Array.isArray(hist) ? hist : hist?.movements || hist?.items || [];
  } catch {
    try {
      const hist = await barkd('/api/v1/wallet/history');
      movements = Array.isArray(hist) ? hist : hist?.history || hist?.items || [];
    } catch {
      return false;
    }
  }

  return movements.some((m) => {
    const amt = Number(pick(m, 'amountSat', 'amount_sat', 'amount', 'sats') || 0);
    const dir = String(pick(m, 'direction', 'type', 'kind') || '').toLowerCase();
    const addr = pick(m, 'address', 'destination', 'arkAddress');
    const incoming =
      dir.includes('in') ||
      dir.includes('receive') ||
      dir.includes('credit') ||
      amt > 0 && !dir.includes('out') && !dir.includes('send');
    if (!incoming) return false;
    if (Math.abs(amt) !== amountSats) return false;
    if (arkAddress && addr && addr !== arkAddress) return false;
    return true;
  });
}

export async function sendPayment({ destination, amountSats, comment }) {
  try {
    return await barkd('/api/v1/wallet/send', {
      method: 'POST',
      body: {
        destination,
        amountSat: amountSats,
        amount_sat: amountSats,
        comment,
      },
    });
  } catch (err) {
    // Fallback Lightning-only pay endpoint
    return barkd('/api/v1/lightning/pay', {
      method: 'POST',
      body: {
        destination,
        amountSat: amountSats,
        amount_sat: amountSats,
        comment,
      },
    });
  }
}

export async function getBalance() {
  const data = await barkd('/api/v1/wallet/balance');
  return {
    spendableSats: Number(
      pick(data, 'spendableSats', 'spendable_sats', 'spendable', 'offchainSats') || 0,
    ),
    raw: data,
  };
}
