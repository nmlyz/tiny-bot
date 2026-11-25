// Tiny Bot: hybrid bars-replay strategy (hourly bars, long-only, no leverage).
// Two legs, one portfolio:
//  - Core (rotation): every 6 bars, hold the top 2 symbols by trailing 12-bar
//    return, only those with a positive return; each at 5% of equity. Small on
//    purpose: momentum rotation loses a little on average in this data, so it is
//    kept tiny — its job is uptrend participation and a steady trade count.
//  - Satellite (oversold bounce): a symbol 3%+ below its 12-bar SMA that just
//    printed a +0.5% hour is bought at 25% of equity and sold at +3%, -1.5%,
//    back at the SMA, or after 12 bars. This is the edge: deep dips that
//    bounce, never the fall itself (buying the dip unconfirmed loses).
//  - Drawdown halt: at 12% equity drawdown everything is sold and entries stop.
// Pure logic, no imports, no clock, no randomness: the offline simulator and
// main.ts (via the makefun-bars SDK) share this file, so sweep results transfer.
// Prices are plain numbers (USDC per unit); the caller converts from wire scales.
// Decisions are made on a bar's close; fills happen at the next bar's open.
export interface HybridParams {
  look: number;       // core: trailing-return lookback (bars)
  period: number;     // core: rebalance every N bars
  coreTop: number;    // core: how many symbols to hold
  coreSize: number;   // core: buy notional as a fraction of equity
  satSma: number;     // satellite: SMA length (bars)
  satDip: number;     // satellite: entry dip below the SMA (fraction)
  satBounce: number;  // satellite: entry last-bar return at least this
  satTp: number;      // satellite: exit at entry * (1 + tp)
  satStop: number;    // satellite: exit at entry * (1 - stop)
  satHold: number;    // satellite: exit after this many bars held
  satSize: number;    // satellite: buy notional as a fraction of equity
  maxPos: number;     // max open positions total
  ddHalt: number;     // halt: equity drawdown at/above this liquidates all
}
export const PARAMS: HybridParams = {
  look: 12, period: 6, coreTop: 2, coreSize: 0.05,
  satSma: 12, satDip: 0.03, satBounce: 0.005, satTp: 0.03, satStop: 0.015,
  satHold: 12, satSize: 0.25, maxPos: 5, ddHalt: 0.12,
};
export type Order =
  | { side: 'buy'; symbol: string; frac: number }
  | { side: 'sell'; symbol: string };
interface Pos { leg: 'core' | 'sat'; entry: number; peak: number; heldBars: number }
export class TinyBot {
  readonly p: HybridParams;
  private closes = new Map<string, number[]>();
  private pos = new Map<string, Pos>();
  private pending = new Set<string>();
  private nextReb: number;
  private entering: string[] | null = null;
  private peakEquity = 0;
  private halted = false;
  private seq = -1;
  constructor(p: HybridParams = PARAMS) { this.p = p; this.nextReb = p.look; }
  get isHalted(): boolean { return this.halted; }
  onBar(closes: ReadonlyMap<string, number>, equity: number, held: ReadonlySet<string>): Order[] {
    const p = this.p;
    this.seq += 1;
    const seq = this.seq;
    for (const [s, c] of closes) {
      const arr = this.closes.get(s) ?? [];
      arr.push(c);
      this.closes.set(s, arr);
      const pp = this.pos.get(s);
      if (pp) { pp.peak = Math.max(pp.peak, c); pp.heldBars += 1; }
    }
    if (equity > this.peakEquity) this.peakEquity = equity;
    const orders: Order[] = [];
    if (!this.halted && this.peakEquity > 0 && 1 - equity / this.peakEquity >= p.ddHalt) {
      this.halted = true;
      for (const s of held) orders.push({ side: 'sell', symbol: s });
      return orders;
    }
    if (this.halted) return [];
    // Satellite exits.
    for (const s of [...held]) {
      const pp = this.pos.get(s);
      if (!pp || pp.leg !== 'sat') continue;
      const arr = this.closes.get(s)!;
      const c = arr[arr.length - 1];
      const m = smaOf(arr, p.satSma)!;
      if (c <= pp.entry * (1 - p.satStop) || c >= pp.entry * (1 + p.satTp) || c >= m || pp.heldBars >= p.satHold) {
        orders.push({ side: 'sell', symbol: s });
        this.pos.delete(s);
      }
    }
    // Core: deferred buys from the previous rebalance's sells.
    if (this.entering !== null) {
      const t = this.entering;
      this.entering = null;
      for (const s of t) {
        if (held.has(s) || this.pos.has(s) || this.pending.has(s)) continue;
        if (coreCount(this.pos) >= p.coreTop) continue;
        orders.push({ side: 'buy', symbol: s, frac: p.coreSize });
        this.pos.set(s, { leg: 'core', entry: this.closes.get(s)!.at(-1)!, peak: this.closes.get(s)!.at(-1)!, heldBars: 0 });
        this.pending.add(s);
      }
      return orders;
    }
    // Core rebalance.
    if (seq >= this.nextReb) {
      this.nextReb = seq + p.period;
      const ranked = [...closes.keys()].sort()
        .map((s) => {
          const a = this.closes.get(s)!;
          return { s, r: a[seq] / a[seq - p.look] - 1 };
        })
        .filter((x) => x.r > 0)
        .sort((a, b) => b.r - a.r)
        .slice(0, p.coreTop)
        .map((x) => x.s);
      const coreHeld = [...this.pos.entries()].filter(([, pp]) => pp.leg === 'core').map(([s]) => s);
      const sells = coreHeld.filter((s) => !ranked.includes(s));
      for (const s of sells) { orders.push({ side: 'sell', symbol: s }); this.pos.delete(s); }
      if (sells.length > 0) { this.entering = ranked; return orders; }
      for (const s of ranked) {
        if (held.has(s) || this.pos.has(s) || this.pending.has(s)) continue;
        if (coreCount(this.pos) >= p.coreTop) break;
        orders.push({ side: 'buy', symbol: s, frac: p.coreSize });
        this.pos.set(s, { leg: 'core', entry: this.closes.get(s)!.at(-1)!, peak: this.closes.get(s)!.at(-1)!, heldBars: 0 });
        this.pending.add(s);
      }
    }
    // Satellite entries.
    for (const s of [...closes.keys()].sort()) {
      const arr = this.closes.get(s)!;
      if (arr.length < p.satSma + 1) continue;
      if (held.has(s) || this.pos.has(s) || this.pending.has(s)) continue;
      if (this.pos.size >= p.maxPos) break;
      const c = arr[arr.length - 1];
      const prev = arr[arr.length - 2];
      const m = smaOf(arr, p.satSma)!;
      if ((m - c) / m >= p.satDip && c / prev - 1 >= p.satBounce) {
        orders.push({ side: 'buy', symbol: s, frac: p.satSize });
        this.pos.set(s, { leg: 'sat', entry: c, peak: c, heldBars: 0 });
        this.pending.add(s);
      }
    }
    return orders;
  }
  noteFilledBuy(symbol: string, price: number): void {
    this.pending.delete(symbol);
    const pp = this.pos.get(symbol);
    if (pp) { pp.entry = price; pp.peak = price; }
  }
  noteBuyRejected(symbol: string): void { this.pending.delete(symbol); this.pos.delete(symbol); }
  noteSold(symbol: string): void { this.pos.delete(symbol); }
}
function coreCount(pos: Map<string, Pos>): number {
  let n = 0;
  for (const pp of pos.values()) if (pp.leg === 'core') n++;
  return n;
}
function smaOf(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}
