"""Daily action list: "buy X today", "your stop on Y is now $Z", "sell half of W".

    quantflow-signals --strategy momentum_core              # reads your Alpaca PAPER account
    quantflow-signals --strategy growth --positions positions.json --equity 50000

Uses the exact rules the backtest uses, so live signals and backtest can't drift apart:
  - New buys only on rebalance days (last trading day of the month), sized at 1% equity
    risk with a 3xATR(14) stop, max 10% of equity per name, max 20 names.
  - Every day: trailing stop = highest (close - 3xATR) since entry, never lowered;
    +20% from entry -> sell half and move the stop to break-even.

It never places orders. You (or a future, separately approved step) act on the list.
Not investment advice; the backtest said what it said.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import pandas as pd
from pandas.tseries.holiday import USFederalHolidayCalendar

from quantflow.broker import Account, AlpacaAccount, BrokerError, Holding, load_positions_file
from quantflow.config import RiskConfig
from quantflow.data.base import DataProvider
from quantflow.indicators import atr
from quantflow.strategies import by_name

HISTORY_BDAYS = 420          # enough for 12-1 momentum plus ATR warm-up
UNKNOWN_ENTRY_LOOKBACK = 60  # if a lot's opening fill is missing, trail from this many days back


@dataclass
class StopState:
    ticker: str
    close: float
    entry_price: float
    initial_stop: float
    stop: float                 # stop to hold from tomorrow
    prev_stop: float            # stop that applied during today's session
    target: float
    target_hit: bool
    action: str                 # SELL_ALL | SELL_HALF | HOLD
    qty_to_sell: int
    note: str


def stop_state(bars: pd.DataFrame, h: Holding, risk: RiskConfig) -> StopState:
    """bars: daily high/low/close for one ticker, indexed by date, ending today."""
    a = atr(bars["high"], bars["low"], bars["close"], risk.atr_period)
    today = bars.index[-1]
    entry = h.entry_date
    note = ""
    if entry is None:
        entry = bars.index[max(0, len(bars) - UNKNOWN_ENTRY_LOOKBACK)]
        note = "entry date unknown; trailing from the last 60 sessions. "
    before = a[a.index < entry].dropna()
    entry_atr = float(before.iloc[-1]) if len(before) else float(a.dropna().iloc[0])
    initial = h.entry_price - risk.atr_multiplier * entry_atr

    since = bars[bars.index >= entry]
    trail = (since["close"] - risk.atr_multiplier * a.reindex(since.index)).cummax()
    target = h.entry_price * (1 + risk.partial_target)
    hit_series = since["high"].cummax() >= target

    def stop_through(n: int) -> float:
        """Stop in force after the close of the n-th session since entry (0-based)."""
        s = initial
        if n >= 0:
            t = trail.iloc[: n + 1].dropna()
            if len(t):
                s = max(s, float(t.iloc[-1]))
            if risk.breakeven_after_partial and (h.partial_taken or bool(hit_series.iloc[n])):
                s = max(s, h.entry_price)
        return s

    n_today = len(since) - 1
    prev_stop = stop_through(n_today - 1) if n_today >= 1 else initial
    stop = stop_through(n_today)
    close, low = float(bars["close"].iloc[-1]), float(bars["low"].iloc[-1])
    target_hit = bool(hit_series.iloc[-1]) if len(hit_series) else False

    if n_today >= 1 and low <= prev_stop:
        action, qty, note = "SELL_ALL", h.qty, note + f"stop ${prev_stop:,.2f} was hit today (low ${low:,.2f})."
    elif target_hit and not h.partial_taken:
        qty = math.floor(h.initial_qty * risk.partial_fraction)
        action = "SELL_HALF" if 0 < qty < h.qty else "HOLD"
        note += f"+{risk.partial_target:.0%} target ${target:,.2f} reached; sell half, stop moves to break-even."
    else:
        action, qty = "HOLD", 0
        if stop > prev_stop + 0.005:
            note += f"raise stop from ${prev_stop:,.2f} to ${stop:,.2f}."
    return StopState(h.ticker, close, h.entry_price, initial, stop, prev_stop, target, target_hit,
                     action, qty, note.strip())


def is_rebalance_day(day: pd.Timestamp) -> bool:
    """Last trading day of the month (US federal holidays approximate the NYSE calendar)."""
    bday = pd.offsets.CustomBusinessDay(calendar=USFederalHolidayCalendar())
    return bool((day + bday).month != day.month)


@dataclass
class Buy:
    ticker: str
    shares: int
    ref_price: float
    stop: float
    target: float
    cost: float
    score: float


def plan_buys(picks: pd.DataFrame, closes: pd.DataFrame, atrs: pd.DataFrame, asof: pd.Timestamp,
              account: Account, held: set[str], free_slots: int, risk: RiskConfig) -> list[Buy]:
    buys: list[Buy] = []
    cash = account.cash
    for row in picks.itertuples(index=False):
        if len(buys) >= free_slots:
            break
        t = str(row.ticker)
        if t in held or t not in closes.columns or t not in atrs.columns:
            continue
        px = float(closes[t].reindex([asof]).to_numpy(dtype=float)[0])
        a = float(atrs[t].reindex([asof]).to_numpy(dtype=float)[0])
        if not (px > 0 and a > 0):
            continue
        dist = risk.atr_multiplier * a
        shares = min(math.floor(risk.risk_per_trade * account.equity / dist),
                     math.floor(risk.max_position_weight * account.equity / px),
                     math.floor(max(cash, 0.0) / px))
        if shares <= 0:
            continue
        cash -= shares * px
        buys.append(Buy(t, shares, px, px - dist, px * (1 + risk.partial_target), shares * px,
                        float(getattr(row, "score", float("nan")))))
    return buys


def _wide(prices: pd.DataFrame, col: str) -> pd.DataFrame:
    out: pd.DataFrame = prices.pivot_table(index="date", columns="ticker", values=col).sort_index()
    return out


def generate(provider: DataProvider, strategy_name: str, account: Account, asof: str | None = None,
             rebalance: str = "auto", risk: RiskConfig | None = None,
             benchmark: str = "SPY") -> dict[str, object]:
    risk = risk or RiskConfig()
    end = asof or pd.Timestamp.today().strftime("%Y-%m-%d")
    start = (pd.Timestamp(end) - pd.tseries.offsets.BDay(HISTORY_BDAYS)).strftime("%Y-%m-%d")
    core = strategy_name.endswith("_core")
    stock_holdings = [h for h in account.holdings if not (core and h.ticker == benchmark)]

    bench_px = provider.prices([benchmark], start, end)
    if bench_px.empty:
        raise ValueError("No benchmark prices; check the data source")
    day = pd.Timestamp(bench_px["date"].max())
    do_rebalance = rebalance == "yes" or (rebalance == "auto" and is_rebalance_day(day))
    bench = bench_px.set_index("date")["close"].sort_index()

    out: dict[str, object] = {"date": day.strftime("%Y-%m-%d"), "strategy": strategy_name,
                              "account": account.source, "equity": account.equity, "cash": account.cash,
                              "rebalance_day": do_rebalance, "actions": [], "holdings": [], "notes": []}
    actions: list[dict[str, object]] = []
    holding_rows: list[dict[str, object]] = []
    notes: list[str] = []

    if strategy_name in ("spy", "spy_trend"):
        sma = float(bench.rolling(200).mean().iloc[-1])
        last = float(bench.iloc[-1])
        held_by = {h.ticker: h for h in account.holdings}
        invest = strategy_name == "spy" or last > sma
        if invest and benchmark not in held_by:
            qty = math.floor(account.cash / last)
            actions.append({"action": "BUY", "ticker": benchmark, "qty": qty, "price": last,
                            "note": "hold the index" if strategy_name == "spy" else
                            f"SPY ${last:,.2f} is above its 200-day average ${sma:,.2f}"})
        elif not invest and benchmark in held_by:
            actions.append({"action": "SELL_ALL", "ticker": benchmark, "qty": held_by[benchmark].qty,
                            "price": last, "note": f"SPY ${last:,.2f} fell below its 200-day average ${sma:,.2f}"})
        else:
            actions.append({"action": "HOLD", "ticker": benchmark, "qty": 0, "price": last,
                            "note": "no change" + ("" if strategy_name == "spy" else f" (200-day avg ${sma:,.2f})")})
        out["actions"] = actions
        return out

    strat = by_name(strategy_name)
    tickers = {h.ticker for h in stock_holdings}
    fund = provider.fundamentals() if do_rebalance else pd.DataFrame()
    if do_rebalance:
        tickers |= set(strat.candidates(fund))
    prices = provider.prices(sorted(tickers | {benchmark}), start, end)
    prices = prices[prices["date"] <= day]
    closes, highs, lows = _wide(prices, "close"), _wide(prices, "high"), _wide(prices, "low")

    # 1. Manage what you hold
    exits: set[str] = set()
    for h in stock_holdings:
        if h.ticker not in closes.columns:
            notes.append(f"{h.ticker}: no recent prices - check it manually.")
            continue
        bars = pd.DataFrame({"high": highs[h.ticker], "low": lows[h.ticker],
                             "close": closes[h.ticker]}).dropna()
        st = stop_state(bars, h, risk)
        out_h = asdict(st)
        out_h["qty"] = h.qty
        holding_rows.append(out_h)
        if st.action == "SELL_ALL":
            exits.add(h.ticker)
        if st.action in ("SELL_ALL", "SELL_HALF"):
            actions.append({"action": st.action, "ticker": h.ticker, "qty": st.qty_to_sell,
                            "price": st.close, "stop": st.stop, "note": st.note})
        elif st.stop > st.prev_stop + 0.005:
            actions.append({"action": "RAISE_STOP", "ticker": h.ticker, "qty": h.qty,
                            "price": st.close, "stop": st.stop, "note": st.note})

    # 2. New buys on rebalance days
    if do_rebalance:
        bench_w = closes[benchmark] if benchmark in closes.columns else bench
        picks = strat.select(fund, closes.drop(columns=[benchmark], errors="ignore"), bench_w, day)
        atrs = pd.DataFrame({t: atr(highs[t], lows[t], closes[t], risk.atr_period)
                             for t in picks["ticker"].head(60) if t in closes.columns})
        held = {h.ticker for h in stock_holdings if h.ticker not in exits}
        slots = risk.max_positions - len(held)
        for b in plan_buys(picks, closes, atrs, day, account, held, slots, risk):
            actions.append({"action": "BUY", "ticker": b.ticker, "qty": b.shares, "price": b.ref_price,
                            "stop": b.stop, "note": f"initial stop ${b.stop:,.2f} (3xATR), "
                            f"half-sale target ${b.target:,.2f}; cost ~${b.cost:,.0f}"})
        if picks.empty:
            notes.append("Rebalance day: no stocks passed the screen.")
    else:
        notes.append("Not a rebalance day: no new buys. New picks come on the last trading day of the month.")

    if core:
        stock_value = sum(float(closes[h.ticker].dropna().iloc[-1]) * h.qty
                          for h in stock_holdings if h.ticker in closes.columns)
        spy_px = float(bench.iloc[-1])
        target_spy = max(account.equity - stock_value, 0.0)
        notes.append(f"Cash sleeve: keep about ${target_spy:,.0f} in SPY (~{math.floor(target_spy / spy_px)} "
                     f"shares at ${spy_px:,.2f}); sell SPY to fund new buys.")
    out["actions"] = actions
    out["holdings"] = holding_rows
    out["notes"] = notes
    return out


def to_markdown(sig: dict[str, object]) -> str:
    acts = sig["actions"]
    assert isinstance(acts, list)
    order = {"SELL_ALL": 0, "SELL_HALF": 1, "BUY": 2, "RAISE_STOP": 3, "HOLD": 4}
    lines = [f"## QuantFlow signals for {sig['date']}",
             f"Strategy **{sig['strategy']}** · {sig['account']} · equity ${float(str(sig['equity'])):,.0f}"
             + (" · **rebalance day**" if sig["rebalance_day"] else ""), ""]
    if not acts:
        lines.append("**No action today.** Holdings and stops are unchanged.")
    else:
        lines += ["| Action | Ticker | Qty | Last close | Stop | What to do |", "|---|---|---|---|---|---|"]
        for a in sorted(acts, key=lambda x: order.get(str(x["action"]), 9)):
            stop = a.get("stop")
            stop_s = f"${float(stop):,.2f}" if isinstance(stop, (int, float)) and not math.isnan(float(stop)) else ""
            lines.append(f"| {str(a['action']).replace('_', ' ')} | {a['ticker']} | {a['qty']} | "
                         f"${float(a['price']):,.2f} | {stop_s} | {a.get('note', '')} |")
    holds = sig.get("holdings") or []
    assert isinstance(holds, list)
    if holds:
        lines += ["", "### Holdings and stops", "", "| Ticker | Qty | Entry | Close | Stop from tomorrow | +20% target |",
                  "|---|---|---|---|---|---|"]
        for h in holds:
            lines.append(f"| {h['ticker']} | {h['qty']} | ${h['entry_price']:,.2f} | ${h['close']:,.2f} | "
                         f"${h['stop']:,.2f} | ${h['target']:,.2f}{' (hit)' if h['target_hit'] else ''} |")
    notes = sig.get("notes") or []
    assert isinstance(notes, list)
    if notes:
        lines += [""] + [f"- {n}" for n in notes]
    lines += ["", "_Signals only; no orders were placed. Hypothetical, not investment advice._"]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    from quantflow.cli import _load_dotenv
    from quantflow.data.factory import SOURCES, ProviderConfigError, Source, make_provider

    p = argparse.ArgumentParser(prog="quantflow-signals")
    p.add_argument("--strategy", required=True,
                   help="growth | growth_core | momentum | momentum_core | spy_trend | spy")
    p.add_argument("--source", choices=SOURCES, default="free")
    p.add_argument("--positions", help="positions.json instead of reading the Alpaca paper account")
    p.add_argument("--equity", type=float, help="override account equity for sizing")
    p.add_argument("--cash", type=float, help="override available cash")
    p.add_argument("--asof", help="evaluate as of this date (default: latest data)")
    p.add_argument("--rebalance", choices=["auto", "yes", "no"], default="auto")
    p.add_argument("--out-dir", default="reports/signals")
    args = p.parse_args(argv)
    source: Source = args.source
    if source != "synthetic":
        _load_dotenv()
    try:
        provider = make_provider(source, fresh=True)
        if args.positions:
            account = load_positions_file(Path(args.positions), args.equity, args.cash)
        else:
            account = AlpacaAccount().snapshot()
            if args.equity is not None:
                account.equity = args.equity
            if args.cash is not None:
                account.cash = args.cash
    except (ProviderConfigError, BrokerError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    sig = generate(provider, args.strategy, account, args.asof, args.rebalance)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    md = to_markdown(sig)
    (out / "signals.md").write_text(md)
    (out / "signals.json").write_text(json.dumps(sig, indent=2, default=str))
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
