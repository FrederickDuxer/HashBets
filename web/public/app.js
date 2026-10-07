const HEX = '0123456789abcdef'.split('');
const OFFSETS = [3, 4, 5, 6, 7, 8];

const state = {
  tip: null,
  health: null,
  bet: null,
  pot: null,
  error: '',
  form: {
    digit: '7',
    amount: 100,
    offset: 3,
    payRail: 'lightning',
    payoutAddress: 'demo@getalby.com',
  },
};

async function req(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function phase(bet) {
  if (!bet) return 'place';
  if (bet.status === 'PENDING_PAYMENT') return 'pay';
  if (bet.status === 'CONFIRMED') return 'placed';
  if (bet.status === 'AWAITING_SIGNATURES') return 'sign';
  if (bet.status === 'SIGNED') return 'signed';
  if (bet.status === 'CANCELLED') return 'cancelled';
  if (
    bet.betResult === 'win' ||
    bet.betResult === 'lose' ||
    String(bet.status).startsWith('SETTLED') ||
    bet.status === 'PAYOUT_FAILED'
  ) {
    return 'result';
  }
  return 'place';
}

function setError(msg) {
  state.error = msg || '';
  const el = document.getElementById('error');
  if (!state.error) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = state.error;
  }
}

function chainKey(chain) {
  if (!chain?.blocks) return '';
  return chain.blocks
    .map(
      (b) =>
        `${b.height}:${b.role}:${b.pot}:${b.paidSats}:${b.winningDigit}:${b.openBets}:${b.pendingBets}:${b.wins}:${b.refunds}:${b.failed}`,
    )
    .join(',');
}

function renderChain(chain) {
  const el = document.getElementById('chain');
  if (!el || !chain?.blocks?.length) return;
  if (el.dataset.key === chainKey(chain) && el.dataset.bet === String(state.bet?.blockNumber ?? '')) return;
  el.dataset.key = chainKey(chain);
  el.dataset.bet = String(state.bet?.blockNumber ?? '');

  const maxSats = Math.max(1, ...chain.blocks.map((b) => Math.max(b.pot || 0, b.paidSats || 0)));
  const cards = chain.blocks
    .map((b) => {
      const weight = Math.max(b.pot || 0, b.paidSats || 0);
      const fill = 28 + Math.round((weight / maxSats) * 72);
      const yours = state.bet?.blockNumber === b.height ? ' yours' : '';
      const digit = b.winningDigit ? `<div class="blk-digit">${escapeHtml(b.winningDigit)}</div>` : '';
      let stat = '';
      if (b.role === 'mined' || b.role === 'payout') {
        stat =
          b.settledBets > 0
            ? `<div class="blk-stat">${b.paidSats} sats paid</div><div class="blk-stat">${b.wins} won · ${b.refunds} refunded${b.failed ? ` · ${b.failed} failed` : ''}</div>`
            : `<div class="blk-stat">no bets settled</div>`;
      } else if (b.role === 'blocked') {
        stat =
          b.openBets > 0
            ? `<div class="blk-stat">${b.pot} sats locked</div><div class="blk-stat">${b.openBets} ${b.openBets === 1 ? 'bet' : 'bets'} · closed</div>`
            : `<div class="blk-stat">closed to new bets</div>`;
      } else {
        const unpaid = b.pendingBets ? ` · ${b.pendingBets} unpaid` : '';
        stat = `<div class="blk-stat">${b.pot} sats</div><div class="blk-stat">${b.openBets} ${b.openBets === 1 ? 'bet' : 'bets'}${unpaid}</div>`;
      }
      const label =
        b.role === 'mined'
          ? 'found'
          : b.role === 'payout'
            ? 'last payout'
            : b.role === 'blocked'
              ? 'closed'
              : 'taking bets';
      return `<article class="blk ${b.role}${yours}" style="--fill:${fill}%">
        <div class="blk-role">${label}</div>
        <div class="blk-h">${b.height}</div>
        ${digit}
        ${stat}
      </article>`;
    })
    .join('');

  el.innerHTML = `<div class="chain-row">${cards}</div>
    <p class="chain-note">Found block is the chain tip. The next blocks are closed to new bets. Stakes collect on tip+${chain.minOffset} through tip+${chain.maxOffset}.</p>`;
}

function renderMeta() {
  const h = state.health;
  document.getElementById('meta').innerHTML = `
    <span>tip ${state.tip ?? '…'}</span>
    <span>offset ${OFFSETS[0]}–${OFFSETS.at(-1)}</span>
    <span>17 payout classes</span>
    <span>barkd ${h ? 'live' : '…'}</span>
  `;
}

function outcomesTable(outcomes, title) {
  if (!outcomes?.length) return '';
  const rows = outcomes
    .map((o) => {
      const amt =
        o.payoutSats == null
          ? o.amountPending
            ? 'TBD at cutoff'
            : '—'
          : `${o.payoutSats} sats`;
      const house = o.settlement?.houseSignature ? 'house' : '—';
      const user = o.settlement?.userSignature ? 'you' : o.round === 2 ? 'unsigned' : 'template';
      return `<tr>
        <td><code>${escapeHtml(o.outcomeId)}</code></td>
        <td>${escapeHtml(amt)}</td>
        <td>${escapeHtml(house)} / ${escapeHtml(user)}</td>
        <td class="break">${escapeHtml(o.settlement?.digest?.slice(0, 16) || '—')}…</td>
        <td class="muted">${escapeHtml(o.note || '')}</td>
      </tr>`;
    })
    .join('');
  return `
    <h3>${escapeHtml(title)}</h3>
    <div class="table-wrap">
      <table class="outcomes">
        <thead><tr><th>Class</th><th>Output</th><th>Sigs</th><th>Digest</th><th>Note</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function potPanel(pot) {
  if (!pot) return '';
  const digitBits = Object.entries(pot.byDigit || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, sats]) => `<span class="chip"><code>${d}</code> ${sats}</span>`)
    .join('');
  const players = (pot.players || [])
    .map(
      (p) => `<tr>
        <td>${escapeHtml(p.simulated ? p.name : 'you')}</td>
        <td><code>${escapeHtml(p.digit)}</code></td>
        <td>${p.amount} sats</td>
        <td>${escapeHtml(p.payRail)}</td>
      </tr>`,
    )
    .join('');
  return `
    <h3>Pot · ${pot.pot} sats · ${pot.betCount} bets</h3>
    <div class="chips">${digitBits || '<span class="muted">no stakes yet</span>'}</div>
    <div class="table-wrap">
      <table class="outcomes">
        <thead><tr><th>Player</th><th>Digit</th><th>Stake</th><th>Rail</th></tr></thead>
        <tbody>${players}</tbody>
      </table>
    </div>`;
}

function captureForm() {
  const amount = document.getElementById('amount');
  if (!amount) return;
  state.form.amount = Number(amount.value);
  state.form.offset = Number(document.getElementById('offset').value);
  const rail = document.querySelector('input[name="payRail"]:checked');
  if (rail) state.form.payRail = rail.value;
  const payout = document.getElementById('payout');
  if (payout) state.form.payoutAddress = payout.value;
}

function viewKey() {
  const bet = state.bet;
  return [
    phase(bet),
    state.tip,
    state.error,
    bet?.id,
    bet?.status,
    bet?.betResult,
    bet?.payoutStatus,
    bet?.payoutError,
    state.pot?.pot,
    state.pot?.betCount,
    state.form.digit,
  ].join('|');
}

function render() {
  captureForm();
  renderMeta();
  setError(state.error);
  const app = document.getElementById('app');
  const p = phase(state.bet);
  const f = state.form;
  const target = state.tip == null ? null : state.tip + f.offset;
  const cutoff = target == null ? null : target - 1;

  if (p === 'place') {
    app.innerHTML = `
      <form class="panel" id="place-form">
        <h2>Place a bet</h2>
        <label>
          Last hex digit
          <div class="digits" id="digits">
            ${HEX.map(
              (d) =>
                `<button type="button" class="digit ${f.digit === d ? 'on' : ''}" data-digit="${d}">${d}</button>`,
            ).join('')}
          </div>
        </label>
        <div class="row">
          <label>
            Amount (sats)
            <input id="amount" type="number" min="100" max="2000" value="${f.amount}" required />
          </label>
          <label>
            Blocks ahead
            <select id="offset">
              ${OFFSETS.map(
                (n) =>
                  `<option value="${n}" ${f.offset === n ? 'selected' : ''}>+${n} → block ${
                    state.tip == null ? '?' : state.tip + n
                  } (cutoff tip ${state.tip == null ? '?' : state.tip + n - 1})</option>`,
              ).join('')}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Pay with</legend>
          <label class="radio"><input type="radio" name="payRail" value="lightning" ${
            f.payRail === 'lightning' ? 'checked' : ''
          }/> Lightning</label>
          <label class="radio"><input type="radio" name="payRail" value="ark" ${
            f.payRail === 'ark' ? 'checked' : ''
          }/> Ark</label>
        </fieldset>
        <label>
          Payout address (LN invoice / LN address / Ark)
          <input id="payout" value="${escapeAttr(f.payoutAddress)}" required />
        </label>
        <p class="hint">
          Target block <strong>${target ?? '…'}</strong>. Betting closes at tip
          <strong>${cutoff ?? '…'}</strong> (one block before). HashBet replies with
          <strong>17 outcomes</strong> (digits 0–f + refund-all).
        </p>
        <button class="primary" type="submit" ${state.tip == null ? 'disabled' : ''}>Continue to pay</button>
      </form>
    `;

    document.getElementById('digits').onclick = (e) => {
      const btn = e.target.closest('[data-digit]');
      if (!btn) return;
      state.form.digit = btn.dataset.digit;
      render();
    };
    document.getElementById('place-form').onsubmit = onPlace;
    return;
  }

  if (p === 'pay') {
    const bet = state.bet;
    app.innerHTML = `
      <section class="panel">
        <h2>Pay to place</h2>
        <p class="hint">Send exactly <strong>${bet.betAmount} sats</strong> via ${bet.payRail}. Waiting for payment…</p>
        <div class="paybox">
          ${
            bet.payRail === 'lightning'
              ? `<p class="hint">Scan the Lightning invoice</p><div id="qr"></div><code class="break">${escapeHtml(bet.paymentRequest)}</code>`
              : `<p>Ark address</p><code class="break">${escapeHtml(
                  bet.arkAddress || bet.paymentRequest,
                )}</code><p class="hint">Amount: ${bet.betAmount} sats</p>`
          }
        </div>
        ${outcomesTable(bet.round1Outcomes, 'Round 1 — 17 payout classes')}
        <div class="actions">
          <button type="button" class="ghost" id="reset">Cancel</button>
        </div>
      </section>
    `;
    if (bet.payRail === 'lightning' && bet.paymentRequest && typeof qrcode === 'function') {
      const host = document.getElementById('qr');
      try {
        const qr = qrcode(0, 'M');
        qr.addData(`lightning:${String(bet.paymentRequest).toUpperCase()}`);
        qr.make();
        host.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
      } catch (err) {
        host.textContent = err.message || 'Could not draw QR';
      }
    }
    document.getElementById('reset').onclick = reset;
    return;
  }

  if (p === 'placed') {
    const bet = state.bet;
    const left = state.tip == null ? '' : ` · ${Math.max(0, bet.blockNumber - state.tip)} left`;
    const untilCutoff =
      state.tip == null ? '' : ` · cutoff in ${Math.max(0, bet.blockNumber - 1 - state.tip)} block(s)`;
    app.innerHTML = `
      <section class="panel success">
        <h2>Bet placed</h2>
        <dl class="facts">
          <div><dt>Bet id</dt><dd>${escapeHtml(bet.id)}</dd></div>
          <div><dt>Amount</dt><dd>${bet.betAmount} sats</dd></div>
          <div><dt>Digit</dt><dd>${bet.chosenDigit}</dd></div>
          <div><dt>Block</dt><dd>${bet.blockNumber}${left}${untilCutoff}</dd></div>
          <div><dt>Payout to</dt><dd class="break">${escapeHtml(bet.payoutAddress)}</dd></div>
        </dl>
        ${potPanel(state.pot)}
        ${outcomesTable(bet.round1Outcomes, 'Round 1 — 17 payout classes')}
        <p class="hint">
          At tip ${bet.blockNumber - 1} the pot closes. HashBet issues 17 house-signed
          settlements with concrete satoshi outputs. You counter-sign them. When block
          ${bet.blockNumber} is mined, Barkd pays only the matching class.
        </p>
        <div class="actions">
          <button type="button" class="ghost" id="reset">New bet</button>
        </div>
      </section>
    `;
    document.getElementById('reset').onclick = reset;
    return;
  }

  if (p === 'sign') {
    const bet = state.bet;
    app.innerHTML = `
      <section class="panel">
        <h2>Sign round-2 payouts</h2>
        <p class="hint">
          Pot closed. Review the 17 payout transactions (one per hash digit + refund) and sign.
          Only the outcome that matches block ${bet.blockNumber} will be broadcast later.
        </p>
        ${potPanel(state.pot)}
        ${outcomesTable(bet.round2Outcomes, 'Round 2 — house-signed settlements')}
        <div class="actions">
          <button class="primary" type="button" id="sign">Sign all 17 outcomes</button>
          <button type="button" class="ghost" id="reset">New bet</button>
        </div>
      </section>
    `;
    document.getElementById('sign').onclick = onSign;
    document.getElementById('reset').onclick = reset;
    return;
  }

  if (p === 'signed') {
    const bet = state.bet;
    app.innerHTML = `
      <section class="panel success">
        <h2>Round-2 signed</h2>
        <p class="hint">
          Waiting for block ${bet.blockNumber}. Barkd will pay the signed settlement
          whose payout class matches the block hash.
        </p>
        ${outcomesTable(bet.round2Outcomes, 'Signed settlements')}
        <div class="actions">
          <button type="button" class="ghost" id="reset">New bet</button>
        </div>
      </section>
    `;
    document.getElementById('reset').onclick = reset;
    return;
  }

  if (p === 'result') {
    const bet = state.bet;
    const win = bet.betResult === 'win';
    app.innerHTML = `
      <section class="panel ${win ? 'success' : 'danger'}">
        <h2>${win ? 'You won' : 'You lost'}</h2>
        <dl class="facts">
          <div><dt>Block</dt><dd>${bet.blockNumber}</dd></div>
          <div><dt>Hash</dt><dd class="break">${escapeHtml(bet.blockHash || '—')}</dd></div>
          <div><dt>Last digit</dt><dd>${bet.winningDigit}</dd></div>
          <div><dt>Active CET</dt><dd>${escapeHtml(bet.activeOutcomeId || '—')}</dd></div>
          <div><dt>Your pick</dt><dd>${bet.chosenDigit}</dd></div>
          <div><dt>${win ? 'Payout' : 'Refund / payout'}</dt>
            <dd>${bet.payoutAmount ?? 0} sats · ${escapeHtml(bet.payoutStatus || '—')}</dd></div>
        </dl>
        ${bet.payoutError ? `<p class="banner error">${escapeHtml(bet.payoutError)}</p>` : ''}
        <button type="button" class="primary" id="reset">Place another bet</button>
      </section>
    `;
    document.getElementById('reset').onclick = reset;
    return;
  }

  if (p === 'cancelled') {
    app.innerHTML = `
      <section class="panel danger">
        <h2>Bet cancelled</h2>
        <p class="hint">Payment window closed at cutoff (one block before betBlock).</p>
        <button type="button" class="primary" id="reset">Try again</button>
      </section>
    `;
    document.getElementById('reset').onclick = reset;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", '&#39;');
}

async function onPlace(e) {
  e.preventDefault();
  state.form.amount = Number(document.getElementById('amount').value);
  state.form.offset = Number(document.getElementById('offset').value);
  state.form.payRail = document.querySelector('input[name="payRail"]:checked').value;
  state.form.payoutAddress = document.getElementById('payout').value.trim();
  setError('');
  try {
    state.bet = await req('/bets', {
      method: 'POST',
      body: JSON.stringify({
        amountSats: state.form.amount,
        chosenDigit: state.form.digit,
        offset: state.form.offset,
        payRail: state.form.payRail,
        payoutAddress: state.form.payoutAddress,
      }),
    });
    state.pot = await req(`/pots/${state.bet.blockNumber}`);
    render();
  } catch (err) {
    setError(err.message);
  }
}

async function onSign() {
  try {
    state.bet = await req(`/bets/${state.bet.id}/sign-round2`, { method: 'POST', body: '{}' });
    render();
  } catch (err) {
    setError(err.message);
  }
}

function reset() {
  state.bet = null;
  state.pot = null;
  setError('');
  render();
}

async function refreshChain() {
  try {
    state.chain = await req('/chain');
    if (state.chain?.tip != null) state.tip = state.chain.tip;
    renderChain(state.chain);
  } catch {
    /* tip endpoint still reports height */
  }
}

async function refreshTip() {
  const before = viewKey();
  try {
    const [health, tip] = await Promise.all([req('/health'), req('/tip')]);
    state.health = health;
    state.tip = tip.tip;
    if (state.error) setError('');
  } catch (err) {
    setError(err.message);
  }
  await refreshChain();
  if (viewKey() !== before) render();
  else renderMeta();
}

async function pollBet() {
  if (!state.bet?.id) return;
  const watch = ['PENDING_PAYMENT', 'CONFIRMED', 'AWAITING_SIGNATURES', 'SIGNED'];
  if (!watch.includes(state.bet.status)) return;
  const before = viewKey();
  try {
    const next = await req(`/bets/${state.bet.id}`);
    const pot = next.blockNumber ? await req(`/pots/${next.blockNumber}`) : state.pot;
    state.bet = next;
    state.pot = pot;
    await refreshChain();
    if (viewKey() !== before) render();
  } catch (err) {
    setError(err.message);
  }
}

refreshTip();
setInterval(refreshTip, 20000);
setInterval(pollBet, 3000);
