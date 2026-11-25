// Tiny Bot: a paper-trading bot for hourly Solana bars (agent-fun/bars-replay/v1).
// Reads the hourly bars, decides when to hold and when to sit in USDC, and trades
// through the vendored makefun-bars shim, which owns the wire protocol. The
// strategy itself lives in strategy.ts; this file only converts its decisions
// into orders, capped by the harness caps (weight, cash, minimum notional).
// Deterministic: no clock, no environment, no randomness — the two grading runs
// produce identical action logs.
import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';
import { TinyBot } from './strategy.ts';

const bot = new TinyBot();
/** price_scale per symbol, from hello. */
const priceScale = new Map<string, number>();
const MAX_SLIPPAGE_BPS = 10_000;

function toPriceFloat(symbol: string, raw: bigint): number {
  return Number(raw) / 10 ** priceScale.get(symbol)!;
}

await runBars({
  onHello(state: BarsState) {
    for (const s of state.hello.symbols) priceScale.set(s.symbol, s.price_scale);
  },
  onBatch(state: BarsState, batch) {
    // Reconcile the fills of the orders decided on the previous batch.
    for (const f of batch.fills) {
      if (f.side === 'buy') {
        if (f.status === 'filled') bot.noteFilledBuy(f.symbol, toPriceFloat(f.symbol, BigInt(f.price)));
        else if (f.status === 'rejected') bot.noteBuyRejected(f.symbol);
      } else if (f.side === 'sell' && f.status === 'filled') {
        bot.noteSold(f.symbol);
      }
    }
    const closes = new Map<string, number>();
    for (const s of state.hello.symbols) {
      const c = state.close(s.symbol);
      if (c !== null) closes.set(s.symbol, toPriceFloat(s.symbol, c));
    }
    const equityUsdc = Number(state.equity) / 1_000_000;
    const held = new Set(state.positions.keys());
    const decisions = bot.onBar(closes, equityUsdc, held);
    const orders: OrderInput[] = [];
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    // Sells first: their proceeds never fund a buy of the same reply, so buys
    // are sized against the cash on hand, exactly as the harness checks them.
    for (const d of decisions) {
      if (d.side !== 'sell') continue;
      const p = state.positions.get(d.symbol);
      if (p !== undefined) {
        orders.push({ side: 'sell', symbol: d.symbol, qty: p.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    let cashLeft = state.cash;
    for (const d of decisions) {
      if (d.side !== 'buy') continue;
      // notional = frac of equity, in whole quote units.
      let notional = (BigInt(Math.round(d.frac * 10_000)) * state.equity) / 10_000n;
      const room = state.weightRoom(d.symbol);
      if (notional > room) notional = room;
      if (notional > cashLeft) notional = cashLeft;
      if (notional < minNotional) {
        bot.noteBuyRejected(d.symbol);
        continue;
      }
      cashLeft -= notional;
      orders.push({ side: 'buy', symbol: d.symbol, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS });
    }
    return orders;
  },
});
