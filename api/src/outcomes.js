import { createHash } from 'crypto';
import { HEX_DIGITS } from './config.js';
import { splitPot } from './pot.js';

/** 16 block-hash nibbles plus the all-wrong refund class. */
export const REFUND_OUTCOME = 'refund';
export const OUTCOME_IDS = [...HEX_DIGITS.split(''), REFUND_OUTCOME];

/**
 * Settlement architecture (Robin Linus roulette gist, §9–10), without its randomness:
 * Script/outcome selects a payout class. A pre-signed settlement commits to concrete outputs.
 * HashBets has 17 classes. The class is chosen by the block-hash nibble (or refund).
 */

function digest(payload) {
  return createHash('sha256').update(payload).digest('hex');
}

function settlementId(betId, outcomeId, round) {
  return digest(`${round}:${betId}:${outcomeId}`).slice(0, 32);
}

/**
 * Output-committing settlement for one payout class.
 * Amount may be null in round 1 when the winning share is not known yet.
 */
export function makeSettlement({
  betId,
  outcomeId,
  round,
  payoutAddress,
  amountSats,
  potSats,
  note,
}) {
  const outputs =
    amountSats == null
      ? []
      : [{ address: payoutAddress, amountSats: Number(amountSats) }];

  const commitment = {
    v: 1,
    betId,
    outcomeId,
    round,
    sighash: 'ALL',
    outputs,
    potSats: potSats ?? null,
  };
  const body = JSON.stringify(commitment);

  return {
    outcomeId,
    payoutClass: outcomeId,
    kind: outcomeId === REFUND_OUTCOME ? 'refund' : 'digit',
    round,
    payoutSats: amountSats,
    amountPending: amountSats == null,
    note,
    payoutAddress,
    settlement: {
      id: settlementId(betId, outcomeId, round),
      type: 'payout_class_settlement',
      commitment,
      body,
      digest: digest(body),
      houseSignature: null,
      userSignature: null,
    },
    signed: false,
  };
}

export function houseSign(settlement) {
  if (!settlement?.digest) throw new Error('settlement digest missing');
  return digest(`house:${settlement.digest}`);
}

export function userSign(settlement, payoutAddress) {
  if (!settlement?.digest) throw new Error('settlement digest missing');
  return digest(`user:${payoutAddress}:${settlement.digest}`);
}

export function verifyUserSignature(settlement, payoutAddress, signature) {
  return signature && signature === userSign(settlement, payoutAddress);
}

/** Round 1: 17 payout classes. Winning digit amount is pending until cutoff. */
export function buildRound1Outcomes({ betId, amountSats, chosenDigit, payoutAddress }) {
  const digitOutcomes = HEX_DIGITS.split('').map((digit) => {
    const isPick = digit === chosenDigit;
    return makeSettlement({
      betId,
      outcomeId: digit,
      round: 1,
      payoutAddress,
      amountSats: isPick ? null : 0,
      note: isPick
        ? 'Payout class for your digit. Share of the pot is fixed at cutoff, then both parties sign.'
        : 'Payout class pays 0 sats if the hash ends in this digit.',
    });
  });

  const refund = makeSettlement({
    betId,
    outcomeId: REFUND_OUTCOME,
    round: 1,
    payoutAddress,
    amountSats,
    note: 'Payout class if nobody matched the nibble: each player is paid their stake back.',
  });

  return [...digitOutcomes, refund];
}

/**
 * Round 2: pot is closed. Each player gets 17 settlements with concrete output amounts.
 * House signs every class. User signatures are collected separately.
 */
export function buildRound2OutcomesForBlock(bets) {
  const pot = bets.reduce((s, b) => s + b.amount_sats, 0);
  const byDigitShares = {};

  for (const digit of HEX_DIGITS) {
    const winners = bets.filter((b) => b.chosen_digit === digit);
    if (winners.length === 0) {
      byDigitShares[digit] = new Map();
      continue;
    }
    const shares = splitPot(winners, pot);
    const map = new Map();
    winners.forEach((w, i) => map.set(w.id, shares[i]));
    byDigitShares[digit] = map;
  }

  const now = new Date().toISOString();
  const perBet = {};

  for (const bet of bets) {
    const classes = OUTCOME_IDS.map((outcomeId) => {
      const amount =
        outcomeId === REFUND_OUTCOME
          ? bet.amount_sats
          : byDigitShares[outcomeId].get(bet.id) || 0;
      const note =
        outcomeId === REFUND_OUTCOME
          ? `Refund class: ${amount} sats to ${bet.payout_address}.`
          : amount > 0
            ? `Class ${outcomeId}: ${amount} sats (share of ${pot} sat pot).`
            : `Class ${outcomeId}: 0 sats.`;

      const row = makeSettlement({
        betId: bet.id,
        outcomeId,
        round: 2,
        payoutAddress: bet.payout_address,
        amountSats: amount,
        potSats: pot,
        note,
      });
      row.settlement.houseSignature = houseSign(row.settlement);
      row.signedAt = null;
      return row;
    });

    perBet[bet.id] = { potSats: pot, issuedAt: now, outcomes: classes };
  }

  return { potSats: pot, issuedAt: now, perBet };
}

export function selectActiveOutcome(winningDigit, bets) {
  const anyWinner = bets.some((b) => b.chosen_digit === winningDigit);
  return anyWinner ? winningDigit : REFUND_OUTCOME;
}
