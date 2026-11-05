"""Strategy and risk configuration. Every number the strategy uses lives here."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ScreenConfig:
    min_revenue_cagr: float = 0.20      # Revenue CAGR > 20%
    cagr_years: int = 3                 # measured over 3 years of as-reported TTM revenue
    max_debt_to_equity: float = 0.5     # D/E < 0.5
    rs_lookback_days: int = 126         # ~6 months of trading days
    min_rs_excess: float = 0.0          # must beat SPY over the lookback
    max_staleness_days: int = 200       # ignore filings older than this (company stopped reporting)


@dataclass(frozen=True)
class RiskConfig:
    risk_per_trade: float = 0.01        # 1% of equity at risk per trade
    atr_period: int = 14                # Wilder ATR, matches Pine ta.atr(14)
    atr_multiplier: float = 3.0         # initial and trailing stop distance
    partial_target: float = 0.20        # +20% from entry
    partial_fraction: float = 0.5       # sell 50% at the target
    breakeven_after_partial: bool = True
    max_positions: int = 20
    max_position_weight: float = 0.10   # cap notional per position at 10% of equity
    slippage_bps: float = 5.0           # applied on every fill
    commission_per_share: float = 0.0


@dataclass(frozen=True)
class BacktestConfig:
    start: str = "2010-01-01"
    end: str = "2026-10-31"
    initial_equity: float = 100_000.0
    rebalance: str = "M"                # month-end screen; entries next session open
    benchmark: str = "SPY"
    risk_free_rate: float = 0.0         # annual, for Sharpe
    exit_on_screen_fail: bool = False   # if True, close names that drop out of the screen
    screen: ScreenConfig = ScreenConfig()
    risk: RiskConfig = RiskConfig()
