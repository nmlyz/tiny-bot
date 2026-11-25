# Strategy

## What the bot does

A hybrid of two legs on hourly bars, long-only, no leverage, $10,000 paper USDC:

**Rotation leg (trade count + uptrend participation).** Every 6 bars it ranks all
seven assets by trailing 12-bar return and holds the top 2 with a positive
return, each at 5% of equity. Positions that fall out of the top 2 are sold;
buys land on the next bar, after the sell proceeds arrive. The size is small on
purpose: momentum rotation on this data loses a little on average, so it is kept
tiny — its job is to stay in the market when it rises and to keep the trade
count comfortably above the 8-trade minimum.

**Oversold-bounce leg (the edge).** An asset 3% or more below its 12-bar average
that just printed a +0.5% hour is bought at 25% of equity — the maximum the
weight cap allows — and sold at the first of: +3% take-profit, −1.5% stop,
back at the 12-bar average, or 12 bars held. Buying the dip itself loses money
(the price usually keeps falling after the first dip); waiting for the bounce
to print is what turns it positive.

**Drawdown halt.** At 12% equity drawdown from the peak, everything is sold and
no new entries are opened for the rest of the run. The guardrail is 25%, so
this leaves a wide margin.

## What was measured

All numbers are from a local replay-model port of the harness fill model
(fill at the next bar's open, 10 bps fee + 5 bps slippage, pool impact, weight
cap, flatten at the end), on the kit's development window (136 hourly bars,
2026-10-29–2026-11-03), unless noted as the kit's `grade-local`. The window is
a down market: equal-weight buy-and-hold loses 8.5% over it.

| bot | net PnL | vs buy-and-hold | max DD |
| --- | --- | --- | --- |
| tiny-bot (this) | −$105 | **+$764** | 2.5% |
| buy-and-hold | −$869 | — | 10.9% |
| oversold bounce only | +$39 | +$908 | 1.3% |
| momentum rotation only (top 2, 12-bar) | −$204 | +$665 | 6.7% |
| dip-buy, weak confirmation (0.2% bounce) | −$628 | +$242 | 8.5% |

The bounce-only version has the best margin but trades in only 4 of 17 rolling
72-bar windows (0 trades in the rest — it would miss the 8-trade minimum), so
the hybrid keeps the bounce leg at full size and adds the small rotation leg
for trade count.

Rolling 72-bar windows (the final window is 3 days = 72 bars; 33 windows at
2-bar steps over the dev data):

| | wins vs buy-and-hold | mean margin | worst margin | min trades | worst DD |
| --- | --- | --- | --- | --- | --- |
| tiny-bot | 25/33 | +$256 | −$405 | 12 | 2.5% |

The 8 losing windows are all in the one stretch where the market rallies and
buy-and-hold gains; the bot is underinvested there by design — the rotation
leg is only 10% of equity — and gives back at most $405 in a window. In every
down or flat window it beats buy-and-hold by $100–$700 while staying near
breakeven itself (mean PnL −$5 per window).

## Why this shape

- **Fees bind everything.** A round trip costs about 0.15% plus impact, so a
  trade needs a real move to profit. That is why the bounce leg demands a
  3% dip and a confirmed +0.5% hour, and why the rotation leg is only 5% per
  position: churning at full size would bleed the edge away.
- **Latency kills fast signals.** Orders decided on a bar's close fill at the
  next bar's open, so a signal that is already spent by the close is worth
  nothing. The bounce leg buys after a strong hour, not during it, and exits
  on the average or a small take-profit rather than chasing the move.
- **The prize bar is buy-and-hold, not zero.** In a falling market, holding
  cash beats holding the market. The bot's job is to preserve capital in the
  falls and take the confirmed bounces, not to out-trade the market every
  hour.
