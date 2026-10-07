# HashBets

Bet on the **last hex digit** (`0`–`f`) of a future Bitcoin block hash. Stakes and payouts are real sats through [Barkd](https://second.tech/docs/barkd) (Lightning and Ark).

## Settlement

Payout-class settlements (same idea as [Robin Linus’s roulette channel](https://gist.github.com/RobinLinus/01d4f40a1d0785fd2d16f7e84f20332d) §9–10). Randomness is the block hash, not commit–reveal preimages.

1. Bet info → **17 payout classes** (`0`–`f` + refund).
2. Pay the Barkd invoice or Ark address. The stake joins that block’s pot.
3. Cutoff at `tip >= betBlock - 1`. No new bets.
4. Round 2: each player gets 17 settlements with **concrete outputs**. House signs every class.
5. Player counter-signs. When `betBlock` is mined, Barkd pays **only the matching class** (pro-rata win, or full refund if nobody hit the digit).

## Run

```bash
cp api/.env.example api/.env
# set BARKD_TOKEN from your barkd datadir
npm start
```

Open http://127.0.0.1:4000

Barkd must be running and funded. `npm run smoke` checks payout-class math without moving sats.

## Rules

| Rule | Value |
| --- | --- |
| Outcome | Last hex nibble of `betBlock` |
| Offset | tip + 3…8 |
| Cutoff | tip ≥ betBlock − 1 |
| Payout | Signed settlement for the winning class, paid in sats via Barkd |

## API

- `POST /bets` — create bet + round-1 classes (creates a real invoice / Ark address)
- `GET /bets/:id` — polls Barkd until the stake is paid
- `POST /bets/:id/sign-round2` — player counter-signs the 17 settlements
- `POST /admin/round2/:block` — issue round 2 after cutoff
- Settlement worker pays the active class once the block exists
