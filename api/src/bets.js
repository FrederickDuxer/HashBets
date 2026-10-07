import { randomBytes } from 'crypto';
import { config, HEX_DIGITS } from './config.js';
import { store, rowToBet } from './db.js';
import {
  createLightningInvoice,
  createArkReceiveAddress,
  isIncomingPaid,
} from './barkd.js';
import { getTipHeight, getBlockHash } from './mempool.js';
import { buildRound1Outcomes } from './outcomes.js';
import {
  potForBlock,
  settleBlock,
  runSettlementPass,
  issueRound2,
  signRound2,
  chainSnapshot,
} from './settlement.js';

function nanoid(size = 12) {
  return randomBytes(Math.ceil((size * 3) / 4))
    .toString('base64url')
    .slice(0, size);
}

function detectPayoutRail(address) {
  const a = String(address || '').trim();
  if (/^ark1/i.test(a) || /^tark1/i.test(a)) return 'ark';
  if (a.includes('@') || /^ln(bc|tb|bcrt)/i.test(a) || /^lno1/i.test(a)) return 'lightning';
  if (a.length > 10) return 'lightning';
  return null;
}

export async function createBet(body) {
  const amountSats = Number(body.amountSats ?? body.betAmount);
  const chosenDigit = String(body.chosenDigit ?? body.digit ?? '')
    .trim()
    .toLowerCase();
  const offset = Number(body.offset);
  const payRail = String(body.payRail || '').toLowerCase();
  const payoutAddress = String(body.payoutAddress || '').trim();

  if (!Number.isInteger(amountSats) || amountSats < config.minBetSats || amountSats > config.maxBetSats) {
    const err = new Error(`amountSats must be an integer between ${config.minBetSats} and ${config.maxBetSats}`);
    err.status = 400;
    throw err;
  }
  if (!HEX_DIGITS.includes(chosenDigit) || chosenDigit.length !== 1) {
    const err = new Error('chosenDigit must be a single hex nibble 0-f');
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(offset) || offset < config.minOffset || offset > config.maxOffset) {
    const err = new Error(`offset must be an integer ${config.minOffset}-${config.maxOffset}`);
    err.status = 400;
    throw err;
  }
  if (payRail !== 'lightning' && payRail !== 'ark') {
    const err = new Error('payRail must be lightning or ark');
    err.status = 400;
    throw err;
  }
  const payoutRail = detectPayoutRail(payoutAddress);
  if (!payoutRail) {
    const err = new Error('payoutAddress must be a Lightning address/invoice or Ark address');
    err.status = 400;
    throw err;
  }

  const tip = await getTipHeight();
  const blockNumber = tip + offset;

  // Bets only until 1 block before betBlock → require tip < betBlock - 1
  if (tip >= blockNumber - 1) {
    const err = new Error(
      `Betting closed for block ${blockNumber} (cutoff at tip ${blockNumber - 1}; current tip ${tip})`,
    );
    err.status = 400;
    throw err;
  }

  const id = nanoid(12);
  const createdAt = new Date().toISOString();
  const round1 = buildRound1Outcomes({
    betId: id,
    amountSats,
    chosenDigit,
    payoutAddress,
  });

  let paymentId = null;
  let paymentRequest = null;
  let arkAddress = null;

  if (payRail === 'lightning') {
    const inv = await createLightningInvoice({
      amountSats,
      description: `HashBets ${id} digit ${chosenDigit} block ${blockNumber}`,
      betId: id,
    });
    paymentId = inv.paymentId;
    paymentRequest = inv.paymentRequest;
  } else {
    const recv = await createArkReceiveAddress();
    paymentId = recv.paymentId;
    arkAddress = recv.address;
    paymentRequest = recv.address;
  }

  store.insertBet({
    id,
    amount_sats: amountSats,
    chosen_digit: chosenDigit,
    block_number: blockNumber,
    pay_rail: payRail,
    payout_rail: payoutRail,
    payout_address: payoutAddress,
    status: 'PENDING_PAYMENT',
    bet_result: null,
    payment_id: paymentId,
    payment_request: paymentRequest,
    ark_address: arkAddress,
    round1_outcomes: round1,
    created_at: createdAt,
  });

  return rowToBet(store.getBet(id));
}

export function getBet(id) {
  return rowToBet(store.getBet(id));
}

export async function refreshBetPayment(id) {
  const row = store.getBet(id);
  if (!row) return null;
  if (row.status !== 'PENDING_PAYMENT') return rowToBet(row);

  const tip = await getTipHeight();
  if (tip >= row.block_number - 1) {
    store.updateBet(id, { status: 'CANCELLED' });
    return rowToBet(store.getBet(id));
  }

  const paid = await isIncomingPaid({
    payRail: row.pay_rail,
    paymentId: row.payment_id,
    amountSats: row.amount_sats,
    arkAddress: row.ark_address,
  });

  if (paid) {
    store.updateBet(id, { status: 'CONFIRMED', confirmed_at: new Date().toISOString() });
  }

  return rowToBet(store.getBet(id));
}

export async function pollPendingPayments() {
  const pending = store.listPendingPayment();
  let tip;
  try {
    tip = await getTipHeight();
  } catch {
    tip = null;
  }

  for (const row of pending) {
    if (tip !== null && tip >= row.block_number - 1) {
      store.updateBet(row.id, { status: 'CANCELLED' });
      continue;
    }
    try {
      const paid = await isIncomingPaid({
        payRail: row.pay_rail,
        paymentId: row.payment_id,
        amountSats: row.amount_sats,
        arkAddress: row.ark_address,
      });
      if (paid) {
        store.updateBet(row.id, {
          status: 'CONFIRMED',
          confirmed_at: new Date().toISOString(),
        });
      }
    } catch {
      /* keep pending */
    }
  }
}

export async function chainView() {
  const tip = await getTipHeight();
  let hash = null;
  try {
    hash = await getBlockHash(tip);
  } catch {
    hash = null;
  }
  return chainSnapshot(tip, hash);
}

export {
  potForBlock,
  settleBlock,
  runSettlementPass,
  issueRound2,
  signRound2,
  getTipHeight,
};
