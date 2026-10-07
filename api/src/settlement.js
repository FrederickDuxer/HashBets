import { config } from './config.js';
import { store, rowToBet } from './db.js';
import { sendPayment } from './barkd.js';
import { getTipHeight, getBlockHash, lastHexNibble } from './mempool.js';
import { splitPot } from './pot.js';
import {
  buildRound2OutcomesForBlock,
  selectActiveOutcome,
  userSign,
  verifyUserSignature,
  REFUND_OUTCOME,
} from './outcomes.js';

export { splitPot };

async function payOut(bet, settlement, kind) {
  const amountSats = settlement?.commitment?.outputs?.[0]?.amountSats ?? 0;
  const destination = settlement?.commitment?.outputs?.[0]?.address || bet.payout_address;
  if (!amountSats || amountSats <= 0) {
    return { payout_status: 'NONE', payout_error: null, amountSats: 0 };
  }
  if (!verifyUserSignature(settlement, bet.payout_address, settlement.userSignature)) {
    return {
      payout_status: 'PAYOUT_FAILED',
      payout_error: 'user signature does not match settlement digest',
      amountSats,
    };
  }
  if (!settlement.houseSignature) {
    return {
      payout_status: 'PAYOUT_FAILED',
      payout_error: 'house signature missing on settlement',
      amountSats,
    };
  }
  try {
    await sendPayment({
      destination,
      amountSats,
      comment: `HashBets ${kind} ${bet.id} class ${settlement.commitment.outcomeId}`,
    });
    return { payout_status: 'SENT', payout_error: null, amountSats };
  } catch (err) {
    return { payout_status: 'PAYOUT_FAILED', payout_error: String(err.message || err), amountSats };
  }
}

/** Close the pot and issue 17 concrete payout txs per bettor. */
export function issueRound2(blockNumber) {
  const confirmed = store.listConfirmedByBlock(blockNumber);
  if (confirmed.length === 0) {
    const existing = store.listOpenByBlock(blockNumber);
    if (existing.some((b) => b.round2_outcomes)) {
      return { issued: 0, already: true, blockNumber };
    }
    return { issued: 0, blockNumber };
  }

  const { potSats, issuedAt, perBet } = buildRound2OutcomesForBlock(confirmed);
  for (const bet of confirmed) {
    const pack = perBet[bet.id];
    store.updateBet(bet.id, {
      status: 'AWAITING_SIGNATURES',
      round2_outcomes: pack.outcomes,
      round2_issued_at: issuedAt,
      pot_sats: potSats,
    });
  }
  return { issued: confirmed.length, potSats, issuedAt, blockNumber };
}

export function signRound2(betId) {
  const row = store.getBet(betId);
  if (!row) return null;
  if (row.status !== 'AWAITING_SIGNATURES') {
    const err = new Error(`bet status is ${row.status}, expected AWAITING_SIGNATURES`);
    err.status = 400;
    throw err;
  }
  if (!row.round2_outcomes?.length) {
    const err = new Error('round-2 outcomes missing');
    err.status = 400;
    throw err;
  }

  const signedAt = new Date().toISOString();
  const outcomes = row.round2_outcomes.map((o) => {
    const settlement = {
      ...o.settlement,
      userSignature: userSign(o.settlement, row.payout_address),
    };
    return {
      ...o,
      settlement,
      signed: true,
      signedAt,
    };
  });

  store.updateBet(betId, {
    status: 'SIGNED',
    round2_outcomes: outcomes,
    signed_at: signedAt,
  });
  return rowToBet(store.getBet(betId));
}

/**
 * Pay the signed settlement whose payout class matches the mined block.
 * Does not invent a hash and does not sign on the player's behalf.
 */
export async function settleBlock(blockNumber) {
  const tip = await getTipHeight();
  const open = store.listOpenByBlock(blockNumber);
  if (open.length === 0) return { settled: 0 };

  if (open.some((b) => b.status === 'CONFIRMED')) {
    if (tip < blockNumber - 1) return { settled: 0, waitingCutoff: true, tip };
    issueRound2(blockNumber);
  }

  const pool = store.listOpenByBlock(blockNumber);
  const awaiting = pool.filter((b) => b.status === 'AWAITING_SIGNATURES');
  if (awaiting.length && pool.every((b) => b.status !== 'SIGNED')) {
    return { settled: 0, waitingSignatures: true, unsigned: awaiting.length, tip };
  }

  if (tip < blockNumber) {
    return { settled: 0, waitingBlock: true, tip };
  }

  const signed = pool.filter((b) => b.status === 'SIGNED' && b.round2_outcomes);
  if (signed.length === 0) {
    return { settled: 0, waitingSignatures: awaiting.length > 0, unsigned: awaiting.length };
  }

  const blockHash = (await getBlockHash(blockNumber)).toLowerCase();
  const winningDigit = lastHexNibble(blockHash);
  const activeOutcomeId = selectActiveOutcome(winningDigit, signed);
  const now = new Date().toISOString();
  const pot = signed[0].pot_sats || signed.reduce((s, b) => s + b.amount_sats, 0);

  for (const bet of signed) {
    const outcome = bet.round2_outcomes.find((o) => o.outcomeId === activeOutcomeId);
    const settlement = outcome?.settlement;
    const isWin = activeOutcomeId !== REFUND_OUTCOME && bet.chosen_digit === winningDigit;
    const kind = activeOutcomeId === REFUND_OUTCOME ? 'refund' : isWin ? 'win' : 'lose';
    const pay = await payOut(bet, settlement, kind);
    const amount = pay.amountSats ?? 0;

    let payoutStatus = pay.payout_status;
    if (activeOutcomeId === REFUND_OUTCOME && pay.payout_status === 'SENT') {
      payoutStatus = 'REFUNDED';
    }

    store.updateBet(bet.id, {
      status: pay.payout_status === 'PAYOUT_FAILED' ? 'PAYOUT_FAILED' : isWin ? 'SETTLED_WIN' : 'SETTLED_LOSE',
      bet_result: isWin ? 'win' : 'lose',
      payout_amount_sats: amount,
      payout_status: payoutStatus,
      payout_error: pay.payout_error,
      block_hash: blockHash,
      winning_digit: winningDigit,
      active_outcome_id: activeOutcomeId,
      settled_at: now,
    });
  }

  for (const bet of store.listOpenByBlock(blockNumber)) {
    if (bet.status === 'SIGNED') continue;
    store.updateBet(bet.id, {
      status: 'PAYOUT_FAILED',
      bet_result: 'lose',
      payout_error: 'round-2 settlement was not signed before the block',
      block_hash: blockHash,
      winning_digit: winningDigit,
      active_outcome_id: activeOutcomeId,
      settled_at: now,
    });
  }

  return {
    settled: signed.length,
    winningDigit,
    blockHash,
    activeOutcomeId,
    mode: activeOutcomeId === REFUND_OUTCOME ? 'refund' : 'payout',
    pot,
  };
}

export async function runSettlementPass() {
  const tip = await getTipHeight();
  const blocks = store.listOpenBlocks();
  const results = [];

  for (const blockNumber of blocks) {
    // Cutoff: issue round-2 one block before betBlock
    if (tip >= blockNumber - 1) {
      const confirmed = store.listConfirmedByBlock(blockNumber);
      if (confirmed.length) {
        results.push({ round2: issueRound2(blockNumber) });
      }
    }
    if (tip >= blockNumber) {
      results.push(await settleBlock(blockNumber));
    }
  }
  return { tip, results };
}

export function potForBlock(blockNumber) {
  const rows = store.listOpenByBlock(blockNumber);
  const bets = rows.map(rowToBet);
  const byDigit = {};
  let pot = 0;
  const players = rows.map((r) => {
    pot += r.amount_sats;
    byDigit[r.chosen_digit] = (byDigit[r.chosen_digit] || 0) + r.amount_sats;
    return {
      id: r.id,
      name: r.bot_name || (r.simulated ? 'bot' : 'you'),
      simulated: Boolean(r.simulated),
      digit: r.chosen_digit,
      amount: r.amount_sats,
      status: r.status,
      payRail: r.pay_rail,
    };
  });
  return {
    blockNumber,
    pot,
    betCount: bets.length,
    byDigit,
    players,
    cutoffBlock: blockNumber - 1,
    bettingOpen: true,
  };
}

const OPEN = new Set(['CONFIRMED', 'AWAITING_SIGNATURES', 'SIGNED']);

function blockSummary(height, role, blockHash) {
  const rows = store.listByBlock(height);
  const open = rows.filter((b) => OPEN.has(b.status));
  const pending = rows.filter((b) => b.status === 'PENDING_PAYMENT');
  const settled = rows.filter(
    (b) => String(b.status).startsWith('SETTLED') || b.status === 'PAYOUT_FAILED',
  );
  const pot = open.reduce((sum, b) => sum + b.amount_sats, 0);
  const paidSats = settled
    .filter((b) => b.payout_status === 'SENT' || b.payout_status === 'REFUNDED')
    .reduce((sum, b) => sum + (b.payout_amount_sats || 0), 0);
  const wins = settled.filter((b) => b.bet_result === 'win').length;
  const refunds = settled.filter((b) => b.payout_status === 'REFUNDED').length;
  const failed = settled.filter(
    (b) => b.status === 'PAYOUT_FAILED' || b.payout_status === 'PAYOUT_FAILED',
  ).length;
  const winningDigit =
    settled.find((b) => b.winning_digit)?.winning_digit ||
    (blockHash ? blockHash.slice(-1) : null);

  return {
    height,
    role,
    hash: blockHash,
    winningDigit,
    pot,
    openBets: open.length,
    pendingBets: pending.length,
    settledBets: settled.length,
    paidSats,
    wins,
    refunds,
    failed,
  };
}

/** Tip, blocks closed to new bets, and the window still collecting stakes. */
export function chainSnapshot(tip, blockHash) {
  const blocks = [blockSummary(tip, 'mined', blockHash || null)];
  for (let height = tip + 1; height < tip + config.minOffset; height++) {
    blocks.push(blockSummary(height, 'blocked', null));
  }
  for (let height = tip + config.minOffset; height <= tip + config.maxOffset; height++) {
    blocks.push(blockSummary(height, 'accumulating', null));
  }

  const tipSummary = blocks[0];
  if (!tipSummary.settledBets) {
    const recent = store
      .allBets()
      .filter(
        (b) =>
          b.block_number < tip &&
          b.block_number >= tip - 18 &&
          (String(b.status).startsWith('SETTLED') || b.status === 'PAYOUT_FAILED'),
      )
      .map((b) => b.block_number);
    const lastHeight = recent.length ? Math.max(...recent) : null;
    if (lastHeight != null) blocks.unshift(blockSummary(lastHeight, 'payout', null));
  }
  return {
    tip,
    minOffset: config.minOffset,
    maxOffset: config.maxOffset,
    blocks,
  };
}
