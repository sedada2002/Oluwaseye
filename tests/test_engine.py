import math
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

from quantflow.config import BacktestConfig, RiskConfig
from quantflow.engine import run_backtest
from quantflow.indicators import atr
from tests.conftest import MiniProvider, growth_fundamentals

DATES = pd.bdate_range("2021-01-04", "2022-12-30")
SIGNAL_DAY = pd.Timestamp("2022-01-31")
ENTRY_DAY = pd.Timestamp("2022-02-01")
CFG = BacktestConfig(
    start="2022-01-03", end="2022-12-30", initial_equity=100_000.0,
    risk=replace(RiskConfig(), slippage_bps=0.0, max_position_weight=1.0, max_positions=1),
)


def _spy() -> pd.Series:
    return pd.Series(np.linspace(400, 410, len(DATES)), index=DATES)


def _path(up_until: pd.Timestamp, up: float, down: float, end: pd.Timestamp | None = None) -> pd.Series:
    idx = DATES if end is None else DATES[DATES <= end]
    px, out = 100.0, []
    for d in idx:
        px *= (1 + up) if d <= up_until else (1 - down)
        out.append(px)
    return pd.Series(out, index=idx)


def _provider(closes: pd.Series) -> MiniProvider:
    return MiniProvider(closes=closes, spy=_spy(),
                        fundamentals_df=growth_fundamentals("GRO", "2017-01-01", "2022-12-31"))


def _signal_atr(p: MiniProvider) -> float:
    px = p.prices(["GRO"], "2000-01-01", "2030-01-01").set_index("date")
    a = atr(px["high"], px["low"], px["close"], 14)
    return float(a.loc[SIGNAL_DAY])


def test_entry_waits_for_next_open_and_risks_one_percent() -> None:
    closes = _path(SIGNAL_DAY, up=0.003, down=0.03)        # collapses right after entry
    p = _provider(closes)
    res = run_backtest(p, CFG)
    first = res.trades.iloc[0]
    assert first["entry_date"] == ENTRY_DAY                 # never on the signal day
    stop_dist = 3.0 * _signal_atr(p)
    assert first["shares"] == math.floor(0.01 * 100_000 / stop_dist)
    # Loss on a clean stop-out is ~1% of equity (a gap through the stop can make it larger)
    assert first["exit_reason"] in ("stop", "stop_gap")
    assert first["pnl"] == pytest.approx(-1000, abs=60)


def test_partial_at_plus_20_then_breakeven_or_better() -> None:
    closes = _path(pd.Timestamp("2022-06-30"), up=0.004, down=0.02)
    res = run_backtest(_provider(closes), CFG)
    first = res.trades.iloc[0]
    assert first["entry_date"] == ENTRY_DAY
    assert bool(first["partial_taken"])
    assert first["exit_price"] >= first["entry_price"]      # stop never fell back below entry
    assert first["pnl"] > 0


def test_stops_only_ratchet_up() -> None:
    """Exit price on a trailing exit must be at or above every earlier stop level, which
    we check indirectly: a long rise then a crash should exit far above entry."""
    closes = _path(pd.Timestamp("2022-09-30"), up=0.004, down=0.05)
    res = run_backtest(_provider(closes), CFG)
    first = res.trades.iloc[0]
    assert first["exit_price"] > first["entry_price"] * 1.5


def test_delisted_name_is_closed_at_last_trade() -> None:
    closes = _path(pd.Timestamp("2022-12-31"), up=0.002, down=0.0, end=pd.Timestamp("2022-06-30"))
    res = run_backtest(_provider(closes), CFG)
    last = res.trades.iloc[-1]
    assert last["exit_reason"] == "delisted"
    assert last["exit_price"] == pytest.approx(closes.iloc[-1])


def test_no_trades_without_passing_fundamentals() -> None:
    p = _provider(_path(SIGNAL_DAY, up=0.003, down=0.0))
    p.fundamentals_df = growth_fundamentals("GRO", "2017-01-01", "2022-12-31", growth=0.05)
    res = run_backtest(p, CFG)
    assert res.trades.empty
    assert res.equity.iloc[-1] == pytest.approx(100_000)
