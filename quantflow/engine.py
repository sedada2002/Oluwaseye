"""Daily event loop enforcing the QuantFlow risk invariants.

Timing (no look-ahead):
  - Screen runs on the close of each rebalance day using only data up to that close.
  - Entries fill at the NEXT session's open (plus slippage), sized off the prior close's equity.
  - Initial stop = entry - atr_multiplier * ATR(signal day).
  - Size = floor(risk_per_trade * equity / stop_distance), capped by max_position_weight
    and available cash.
  - Intraday, the stop is checked before the profit target. If a bar touches both,
    we assume the stop hit first (conservative; daily bars can't tell us the order).
  - At +partial_target, sell partial_fraction; stop moves to break-even.
  - After the close, the trailing stop ratchets up: max(stop, close - mult * ATR). Never down.
  - A ticker whose price history ends (delisting) is closed at its last close.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
import pandas as pd

from quantflow.config import BacktestConfig
from quantflow.data.base import DataProvider
from quantflow.indicators import atr_wide
from quantflow.strategies import GrowthStrategy, Strategy

FloatArray = npt.NDArray[np.float64]


@dataclass
class Position:
    ticker: str
    col: int
    shares: int
    entry_date: pd.Timestamp
    entry_price: float
    stop: float
    initial_shares: int
    partial_taken: bool = False
    realized: float = 0.0           # P&L banked so far (partials + final)
    cost: float = 0.0               # total cash paid on entry incl. costs


@dataclass
class BacktestResult:
    equity: pd.Series
    benchmark: pd.Series
    trades: pd.DataFrame
    holdings: pd.DataFrame          # rebalance-day snapshot: date, ticker, sector, value, weight
    screens: pd.DataFrame           # every screen pass: date, ticker, revenue_cagr, de, rs_excess
    config: BacktestConfig
    notes: list[str] = field(default_factory=list)


class PriceBook:
    """Date x ticker numpy arrays aligned to the benchmark's trading calendar."""

    def __init__(self, prices: pd.DataFrame, calendar: pd.DatetimeIndex, atr_period: int) -> None:
        def wide(col: str) -> pd.DataFrame:
            return prices.pivot_table(index="date", columns="ticker", values=col).reindex(calendar)

        close = wide("close")
        high, low = wide("high"), wide("low")
        self.tickers: list[str] = [str(c) for c in close.columns]
        self.col: dict[str, int] = {t: i for i, t in enumerate(self.tickers)}
        self.close_df = close                                   # used by the screen
        self.o: FloatArray = wide("open").reindex(columns=close.columns).to_numpy(dtype=np.float64)
        self.h: FloatArray = high.reindex(columns=close.columns).to_numpy(dtype=np.float64)
        self.l: FloatArray = low.reindex(columns=close.columns).to_numpy(dtype=np.float64)
        self.c: FloatArray = close.to_numpy(dtype=np.float64)
        self.atr: FloatArray = atr_wide(high, low, close, atr_period).to_numpy(dtype=np.float64)
        valid = ~np.isnan(self.c)
        n = len(calendar)
        # last row with a price for each ticker (-1 if none)
        self.last_row = np.where(valid.any(axis=0), n - 1 - np.argmax(valid[::-1], axis=0), -1)

    def last_close(self, j: int, upto: int) -> float:
        col = self.c[: upto + 1, j]
        valid = np.flatnonzero(~np.isnan(col))
        return float(col[valid[-1]]) if len(valid) else float("nan")


def run_backtest(
    provider: DataProvider,
    cfg: BacktestConfig | None = None,
    strategy: Strategy | None = None,
) -> BacktestResult:
    cfg = cfg or BacktestConfig()
    strat: Strategy = strategy or GrowthStrategy(screen=cfg.screen, name="growth", label="Growth screen")
    rc = cfg.risk
    notes: list[str] = []

    universe = provider.universe()
    fund = provider.fundamentals()
    fund = fund[fund["ticker"].isin(universe["ticker"])]
    candidates = strat.candidates(fund)
    sector_of = provider.sectors(candidates)
    notes.extend(getattr(provider, "caveats", []))
    notes.append(f"{len(candidates)} tickers pass the fundamental legs on at least one filing.")

    # Warm-up so ATR and RS lookbacks are populated on the first rebalance day
    warmup_start = pd.Timestamp(cfg.start) - pd.tseries.offsets.BDay(strat.warmup_days + 60)
    prices = provider.prices([*candidates, cfg.benchmark], warmup_start.strftime("%Y-%m-%d"), cfg.end)
    bench_px = prices[prices["ticker"] == cfg.benchmark].set_index("date")["close"].sort_index()
    if bench_px.empty:
        raise ValueError(f"No prices for benchmark {cfg.benchmark}")
    calendar = pd.DatetimeIndex(bench_px.index)
    book = PriceBook(prices[prices["ticker"] != cfg.benchmark], calendar, rc.atr_period)

    in_window = (calendar >= pd.Timestamp(cfg.start)) & (calendar <= pd.Timestamp(cfg.end))
    sim_rows = np.flatnonzero(in_window)
    if len(sim_rows) == 0:
        raise ValueError("No trading days in the requested window")
    sim_days = calendar[sim_rows]
    periods = sim_days.to_period(cfg.rebalance)
    rebalance_rows = {int(sim_rows[i]) for i in range(len(sim_rows))
                      if i == len(sim_rows) - 1 or periods[i] != periods[i + 1]}

    slip = rc.slippage_bps / 10_000.0
    cash = cfg.initial_equity
    prev_equity = cfg.initial_equity
    positions: dict[str, Position] = {}
    pending_entries: list[tuple[str, float]] = []   # (ticker, ATR on signal day)
    pending_exits: set[str] = set()
    equity_curve: list[float] = []
    trade_rows: list[dict[str, object]] = []
    holding_rows: list[dict[str, object]] = []
    screen_rows: list[pd.DataFrame] = []

    def sell(pos: Position, shares: int, raw_px: float, day: pd.Timestamp, reason: str) -> None:
        nonlocal cash
        px = raw_px * (1 - slip)
        proceeds = shares * px - shares * rc.commission_per_share
        cash += proceeds
        pos.realized += proceeds - shares * (pos.cost / pos.initial_shares)
        pos.shares -= shares
        if pos.shares == 0:
            trade_rows.append({
                "ticker": pos.ticker,
                "sector": sector_of.get(pos.ticker, "Unknown"),
                "entry_date": pos.entry_date,
                "exit_date": day,
                "entry_price": pos.entry_price,
                "exit_price": px,
                "shares": pos.initial_shares,
                "pnl": pos.realized,
                "return": pos.realized / pos.cost,
                "partial_taken": pos.partial_taken,
                "exit_reason": reason,
            })
            del positions[pos.ticker]

    def mark(i: int) -> float:
        return cash + sum(p.shares * book.last_close(p.col, i) for p in positions.values())

    bench_c = bench_px.to_numpy(dtype=np.float64)
    first_row = int(sim_rows[0])
    if strat.idle_cash_in_benchmark:
        notes.append("Idle cash earns SPY's daily return (core-satellite); no costs modeled on that sleeve.")

    for i in (int(r) for r in sim_rows):
        day = calendar[i]
        if strat.idle_cash_in_benchmark and i > first_row and cash > 0:
            cash *= bench_c[i] / bench_c[i - 1]

        # 1. Fills at the open: queued exits first (frees cash), then entries
        for t in sorted(pending_exits):
            if t in positions and not math.isnan(book.o[i, positions[t].col]):
                sell(positions[t], positions[t].shares, float(book.o[i, positions[t].col]), day, "screen_exit")
        pending_exits = set()

        for t, signal_atr in pending_entries:
            if t in positions or len(positions) >= rc.max_positions:
                continue
            j = book.col[t]
            o = float(book.o[i, j])
            if math.isnan(o) or signal_atr <= 0:
                continue
            fill = o * (1 + slip)
            stop_dist = rc.atr_multiplier * signal_atr
            shares = math.floor(rc.risk_per_trade * prev_equity / stop_dist)
            shares = min(shares, math.floor(rc.max_position_weight * prev_equity / fill))
            shares = min(shares, math.floor(cash / (fill + rc.commission_per_share)))
            if rc.max_sector_weight < 1.0:
                sector = sector_of.get(t, "Unknown")
                in_sector = sum(p.shares * book.last_close(p.col, i - 1) for p in positions.values()
                                if sector_of.get(p.ticker, "Unknown") == sector)
                room = rc.max_sector_weight * prev_equity - in_sector
                shares = min(shares, math.floor(max(room, 0.0) / fill))
            if shares <= 0:
                continue
            cost = shares * (fill + rc.commission_per_share)
            cash -= cost
            positions[t] = Position(ticker=t, col=j, shares=shares, entry_date=day,
                                    entry_price=fill, stop=fill - stop_dist,
                                    initial_shares=shares, cost=cost)
        pending_entries = []

        # 2. Intraday risk management
        for pos in list(positions.values()):
            j = pos.col
            o, h, lo = float(book.o[i, j]), float(book.h[i, j]), float(book.l[i, j])
            if math.isnan(o):
                if i > book.last_row[j]:
                    sell(pos, pos.shares, book.last_close(j, i), day, "delisted")
                continue
            if o <= pos.stop:
                sell(pos, pos.shares, o, day, "stop_gap")
                continue
            if lo <= pos.stop:
                sell(pos, pos.shares, pos.stop, day, "stop")
                continue
            target = pos.entry_price * (1 + rc.partial_target)
            if not pos.partial_taken and h >= target:
                qty = math.floor(pos.initial_shares * rc.partial_fraction)
                if 0 < qty < pos.shares:
                    sell(pos, qty, max(o, target), day, "partial")
                pos.partial_taken = True
                if rc.breakeven_after_partial:
                    pos.stop = max(pos.stop, pos.entry_price)

        # 3. After the close: ratchet trailing stops (never lower)
        for pos in positions.values():
            c, a = float(book.c[i, pos.col]), float(book.atr[i, pos.col])
            if not (math.isnan(c) or math.isnan(a)):
                pos.stop = max(pos.stop, c - rc.atr_multiplier * a)

        equity = mark(i)
        equity_curve.append(equity)
        prev_equity = equity

        # 4. Rebalance: screen on today's close, act at tomorrow's open
        if i in rebalance_rows:
            picks = strat.select(fund, book.close_df, bench_px, day)
            if not picks.empty:
                screen_rows.append(picks.assign(date=day))
            passing = set(picks["ticker"])
            if cfg.exit_on_screen_fail:
                pending_exits = {t for t in positions if t not in passing}
            # Queue every pick in rank order. The fill loop stops at max_positions, so if a
            # name can't be bought (no open, no cash, sector cap) the next-ranked one gets the slot.
            if len(positions) - len(pending_exits) < rc.max_positions:
                for t in picks["ticker"]:
                    if t in positions and t not in pending_exits:
                        continue
                    a = float(book.atr[i, book.col[t]])
                    if not math.isnan(a):
                        pending_entries.append((t, a))
            for t, pos in positions.items():
                value = pos.shares * book.last_close(pos.col, i)
                holding_rows.append({"date": day, "ticker": t, "sector": sector_of.get(t, "Unknown"),
                                     "value": value, "weight": value / equity})

    # Close anything still open at the final close so every trade is counted
    last_i, last_day = int(sim_rows[-1]), sim_days[-1]
    for pos in list(positions.values()):
        sell(pos, pos.shares, book.last_close(pos.col, last_i), last_day, "end_of_test")

    eq = pd.Series(equity_curve, index=sim_days, name="strategy")
    bench = bench_px.reindex(sim_days)
    bench = (bench / bench.iloc[0] * cfg.initial_equity).rename(cfg.benchmark)
    notes.append("Prices are split-adjusted; dividends are excluded for both strategy and SPY.")
    delisted = sum(1 for r in trade_rows if r["exit_reason"] == "delisted")
    if delisted:
        notes.append(f"{delisted} trades closed at the last traded price on delisting; "
                     "real delisting returns can be worse.")

    return BacktestResult(
        equity=eq,
        benchmark=bench,
        trades=pd.DataFrame(trade_rows),
        holdings=pd.DataFrame(holding_rows),
        screens=pd.concat(screen_rows, ignore_index=True) if screen_rows else pd.DataFrame(),
        config=cfg,
        notes=notes,
    )
