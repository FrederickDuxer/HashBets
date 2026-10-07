/** Integer pro-rata split that sums exactly to pot. */
export function splitPot(winners, pot) {
  const totalStake = winners.reduce((s, b) => s + b.amount_sats, 0);
  if (totalStake <= 0) return winners.map(() => 0);

  const raw = winners.map((b) => (b.amount_sats / totalStake) * pot);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = pot - floors.reduce((a, b) => a + b, 0);

  const order = raw
    .map((x, i) => ({ i, frac: x - floors[i] }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floors];
  for (let k = 0; k < remainder; k++) {
    out[order[k % order.length].i] += 1;
  }
  return out;
}
