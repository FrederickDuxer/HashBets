import fs from 'fs';
import path from 'path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

function readAll() {
  if (!fs.existsSync(config.dbPath)) return { bets: [] };
  return JSON.parse(fs.readFileSync(config.dbPath, 'utf8'));
}

function writeAll(data) {
  fs.writeFileSync(config.dbPath, JSON.stringify(data, null, 2));
}

const OPEN_STATUSES = new Set(['CONFIRMED', 'AWAITING_SIGNATURES', 'SIGNED']);

export function rowToBet(row) {
  if (!row) return null;
  return {
    id: row.id,
    betAmount: row.amount_sats,
    chosenDigit: row.chosen_digit,
    blockNumber: row.block_number,
    payRail: row.pay_rail,
    payoutRail: row.payout_rail,
    payoutAddress: row.payout_address,
    status: row.status,
    betResult: row.bet_result ?? null,
    paymentId: row.payment_id,
    paymentRequest: row.payment_request,
    arkAddress: row.ark_address,
    payoutAmount: row.payout_amount_sats ?? null,
    payoutStatus: row.payout_status ?? null,
    payoutError: row.payout_error ?? null,
    blockHash: row.block_hash ?? null,
    winningDigit: row.winning_digit ?? null,
    activeOutcomeId: row.active_outcome_id ?? null,
    round1Outcomes: row.round1_outcomes ?? null,
    round2Outcomes: row.round2_outcomes ?? null,
    round2IssuedAt: row.round2_issued_at ?? null,
    signedAt: row.signed_at ?? null,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? null,
    settledAt: row.settled_at ?? null,
  };
}

export const store = {
  insertBet(row) {
    const data = readAll();
    data.bets.push(row);
    writeAll(data);
  },
  getBet(id) {
    return readAll().bets.find((b) => b.id === id) || null;
  },
  updateBet(id, patch) {
    const data = readAll();
    const idx = data.bets.findIndex((b) => b.id === id);
    if (idx < 0) return null;
    data.bets[idx] = { ...data.bets[idx], ...patch };
    writeAll(data);
    return data.bets[idx];
  },
  listPendingPayment() {
    return readAll().bets.filter((b) => b.status === 'PENDING_PAYMENT');
  },
  listByBlock(blockNumber) {
    return readAll().bets.filter((b) => b.block_number === blockNumber);
  },
  allBets() {
    return readAll().bets;
  },
  listOpenByBlock(blockNumber) {
    return readAll().bets.filter(
      (b) => OPEN_STATUSES.has(b.status) && b.block_number === blockNumber,
    );
  },
  listConfirmedByBlock(blockNumber) {
    return readAll().bets.filter(
      (b) => b.status === 'CONFIRMED' && b.block_number === blockNumber,
    );
  },
  listAwaitingSignaturesByBlock(blockNumber) {
    return readAll().bets.filter(
      (b) => b.status === 'AWAITING_SIGNATURES' && b.block_number === blockNumber,
    );
  },
  listSignedByBlock(blockNumber) {
    return readAll().bets.filter(
      (b) => b.status === 'SIGNED' && b.block_number === blockNumber,
    );
  },
  listOpenBlocks() {
    const set = new Set(
      readAll()
        .bets.filter((b) => OPEN_STATUSES.has(b.status))
        .map((b) => b.block_number),
    );
    return [...set].sort((a, b) => a - b);
  },
  /** @deprecated use listOpenBlocks */
  listConfirmedBlocks() {
    return this.listOpenBlocks();
  },
};
