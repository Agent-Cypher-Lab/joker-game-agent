# Game Mechanics

## Deck

19 cards. Values sorted: `[1,2,3,4,5,6,7,8,9,10,11,12,13,15,16,17,18,19,20]`
Higher value = better. Max 20, min 1.

## Round Flow

```
ROUND_OPEN → DEAL (1 card/seat) → SWAP (optional) → FINALIZE → CLOSE
```

- All deals complete before swaps accepted
- Max 1 swap per seat, max 1 finalize per seat
- Timeout (default 60s) → non-finalized seats auto-finalize with current card

## Ranking

1. Sort by card value descending
2. Ties broken by lower seatId first

## Payout

```
totalPot = N × (entryFee + swapFee)
adjustedPot = totalPot − countNotSwapped × swapFee   (non-swappers get refund)

1st: 50% of adjustedPot
2nd: 30%
3rd: remainder (~20%)
4th+: nothing
```
