import { splitPot } from './pot.js';
import {
  buildRound1Outcomes,
  buildRound2OutcomesForBlock,
  houseSign,
  userSign,
  verifyUserSignature,
  selectActiveOutcome,
} from './outcomes.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const shares = splitPot([{ amount_sats: 100 }, { amount_sats: 300 }], 400);
assert(shares[0] === 100 && shares[1] === 300, `shares ${shares}`);

const round1 = buildRound1Outcomes({
  betId: 'bet1',
  amountSats: 100,
  chosenDigit: '7',
  payoutAddress: 'demo@getalby.com',
});
assert(round1.length === 17, `classes ${round1.length}`);
assert(round1.find((o) => o.outcomeId === '7').amountPending, 'winning class pending');
assert(round1.find((o) => o.outcomeId === '0').payoutSats === 0, 'losing class is 0');
assert(round1.find((o) => o.outcomeId === 'refund').payoutSats === 100, 'refund stake');
assert(round1.every((o) => o.settlement.digest && o.settlement.commitment.sighash === 'ALL'), 'commitment');

const bets = [
  { id: 'a', amount_sats: 100, chosen_digit: '7', payout_address: 'a@ln' },
  { id: 'b', amount_sats: 300, chosen_digit: '7', payout_address: 'b@ln' },
  { id: 'c', amount_sats: 100, chosen_digit: 'a', payout_address: 'ark1c' },
];
const round2 = buildRound2OutcomesForBlock(bets);
assert(round2.potSats === 500, `pot ${round2.potSats}`);
const a7 = round2.perBet.a.outcomes.find((o) => o.outcomeId === '7');
const b7 = round2.perBet.b.outcomes.find((o) => o.outcomeId === '7');
assert(a7.payoutSats === 125, `a share ${a7.payoutSats}`);
assert(b7.payoutSats === 375, `b share ${b7.payoutSats}`);
assert(a7.payoutSats + b7.payoutSats === 500, 'class sums to pot');
assert(a7.settlement.houseSignature === houseSign(a7.settlement), 'house sig');
assert(a7.settlement.commitment.outputs[0].amountSats === 125, 'output amount');

const sig = userSign(a7.settlement, 'a@ln');
assert(verifyUserSignature(a7.settlement, 'a@ln', sig), 'user sig verifies');
assert(!verifyUserSignature(a7.settlement, 'other@ln', sig), 'sig bound to address');

assert(selectActiveOutcome('7', bets) === '7', 'winner class');
assert(selectActiveOutcome('1', bets) === 'refund', 'refund class');

console.log('OK — payout-class settlements (no sat movement)');
