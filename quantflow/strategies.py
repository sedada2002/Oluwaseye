"""Strategy library. Each strategy decides WHAT to buy on rebalance days; the engine's
risk rules (1% risk sizing, 3xATR trailing stop, 50% at +20%, break-even) decide HOW.

All strategies are textbook versions with standard parameters, chosen before looking at
results - not tuned to this data. That matters: tuning on the same data you grade on
manufactures fake edges.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Protocol

import numpy as np
import pandas as pd

from quantflow.config import ScreenConfig
from quantflow.screen import fundamental_candidates, fundamental_snapshot, run_screen

MIN_REVENUE = 500e6     # liquid, real businesses only - the floor that fixed the biotech problem


class Strategy(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def label(self) -> str: ...

    @property
    def warmup_days(self) -> int: ...           # price history needed before the first signal

    @property
    def idle_cash_in_benchmark(self) -> bool: ...   # uninvested cash earns the benchmark's return

    def candidates(self, fund: pd.DataFrame) -> list[str]: ...

    def select(self, fund: pd.DataFrame, closes: pd.DataFrame, bench: pd.Series,
               asof: pd.Timestamp) -> pd.DataFrame: ...


@dataclass(frozen=True)
class GrowthStrategy:
    """The original QuantFlow screen: revenue CAGR > 20%, D/E < 0.5, beating SPY over
    6 months, plus a $500M revenue floor. Ranked by relative strength."""

    name: str = "growth"
    label: str = "Growth screen"
    idle_cash_in_benchmark: bool = False
    screen: ScreenConfig = field(default_factory=lambda: replace(ScreenConfig(), min_revenue=MIN_REVENUE))

    @property
    def warmup_days(self) -> int:
        return self.screen.rs_lookback_days

    def candidates(self, fund: pd.DataFrame) -> list[str]:
        return fundamental_candidates(fund, self.screen)

    def select(self, fund: pd.DataFrame, closes: pd.DataFrame, bench: pd.Series,
               asof: pd.Timestamp) -> pd.DataFrame:
        picks = run_screen(fund, closes, bench, asof, self.screen)
        return picks.assign(score=picks["rs_excess"])


@dataclass(frozen=True)
class MomentumStrategy:
    """Classic 12-1 cross-sectional momentum (Jegadeesh-Titman): rank by the return from
    12 months ago to 1 month ago, skipping the last month (short-term reversal). Universe:
    companies with >= $500M TTM revenue as of the rebalance date, price >= $5.
    Only names with positive momentum that also beat SPY's 12-1 return are eligible."""

    name: str = "momentum"
    label: str = "12-1 momentum"
    idle_cash_in_benchmark: bool = False
    lookback: int = 252
    skip: int = 21
    min_revenue: float = MIN_REVENUE
    min_price: float = 5.0
    warmup_days: int = 252

    def candidates(self, fund: pd.DataFrame) -> list[str]:
        return sorted(fund.loc[fund["revenue"] >= self.min_revenue, "ticker"].unique().tolist())

    def select(self, fund: pd.DataFrame, closes: pd.DataFrame, bench: pd.Series,
               asof: pd.Timestamp) -> pd.DataFrame:
        empty = pd.DataFrame(columns=["ticker", "score", "momentum"])
        idx = closes.index
        if asof not in idx:
            return empty
        pos = idx.get_loc(asof)
        if not isinstance(pos, int) or pos < self.lookback:
            return empty
        t_recent, t_old = idx[pos - self.skip], idx[pos - self.lookback]
        snap = fundamental_snapshot(fund, asof, ScreenConfig())   # point-in-time revenue
        eligible = set(snap.loc[snap["revenue"] >= self.min_revenue, "ticker"])
        cols = [c for c in closes.columns if c in eligible]
        if not cols:
            return empty
        now = closes.loc[asof, cols]
        mom = closes.loc[t_recent, cols] / closes.loc[t_old, cols] - 1.0
        bench_mom = float(bench.loc[t_recent] / bench.loc[t_old] - 1.0)
        ok = now.notna() & (now >= self.min_price) & mom.notna() & (mom > 0) & (mom > bench_mom)
        m = mom[ok].sort_values(ascending=False)
        return pd.DataFrame({"ticker": m.index.astype(str), "score": m.to_numpy(),
                             "momentum": m.to_numpy()}).reset_index(drop=True)


def with_core(s: GrowthStrategy | MomentumStrategy) -> GrowthStrategy | MomentumStrategy:
    """Same picks, but idle cash sits in SPY instead of earning nothing (core-satellite)."""
    return replace(s, name=f"{s.name}_core", label=f"{s.label} + idle cash in SPY",
                   idle_cash_in_benchmark=True)


def spy_trend_equity(bench: pd.Series, start: str, end: str, ma: int = 200,
                     initial: float = 100_000.0) -> pd.Series:
    """Hold SPY while it closes above its 200-day average, otherwise cash. The decision
    uses today's close and applies from tomorrow, so there's no look-ahead."""
    b = bench.sort_index()
    sma = b.rolling(ma).mean()
    invested = (b > sma).shift(1, fill_value=False)
    rets = b.pct_change().fillna(0.0)
    strat = np.where(invested, rets, 0.0)
    window = (b.index >= pd.Timestamp(start)) & (b.index <= pd.Timestamp(end))
    eq = pd.Series(initial * np.cumprod(1.0 + strat[window]), index=b.index[window], name="spy_trend")
    return eq


def library() -> list[GrowthStrategy | MomentumStrategy]:
    g, m = GrowthStrategy(), MomentumStrategy()
    return [g, with_core(g), m, with_core(m)]


def by_name(name: str) -> GrowthStrategy | MomentumStrategy:
    for s in library():
        if s.name == name:
            return s
    raise KeyError(f"Unknown strategy {name!r}; choose from {[s.name for s in library()]}")
