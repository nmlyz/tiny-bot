# tiny-bot

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/nmlyz/tiny-bot/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/nmlyz/tiny-bot/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A small paper-trading bot for hourly Solana prices. It reads the hourly bars of seven assets (SOL, WETH, JITOSOL, RAY, POPCAT, WIF, FARTCOIN), decides when to hold and when to sit in USDC, and trades long-only with no leverage.

## Strategy

Two legs, one portfolio — see [STRATEGY.md](STRATEGY.md) for the full write-up with measured numbers:

- **Rotation:** every 6 hours it holds the top 2 assets by trailing 12-hour return, only those with a positive return, each at 5% of equity.
- **Oversold bounce:** an asset 3% or more below its 12-hour average that just printed a +0.5% hour is bought at 25% of equity and sold at +3%, −1.5%, back at the average, or after 12 hours.
- **Drawdown halt:** at 12% equity drawdown everything is sold and entries stop.

The bot is deterministic: no clock, no environment, no randomness, so repeated runs produce identical action logs.

## Run it

```sh
node main.ts
```

Node 22.18 or later. `main.ts` speaks the `agent-fun/bars-replay/v1` line protocol on stdin/stdout; `vendor/makefun-bars.ts` is the protocol shim, `strategy.ts` is the strategy. Everything the bot runs is in this repository.
