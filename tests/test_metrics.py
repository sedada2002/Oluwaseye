import pandas as pd
import pytest

from quantflow.metrics import performance, sector_concentration, trade_stats


def test_drawdown_and_cagr_known_series() -> None:
    idx = pd.to_datetime(["2020-01-01", "2020-07-01", "2021-01-01"])
    eq = pd.Series([100.0, 80.0, 121.0], index=idx)
    p = performance(eq)
    assert p.max_drawdown == pytest.approx(-0.20)
    years = (idx[-1] - idx[0]).days / 365.25
    assert p.cagr == pytest.approx(1.21 ** (1 / years) - 1)


def test_trade_stats_win_rate() -> None:
    trades = pd.DataFrame({
        "pnl": [100.0, -50.0, 200.0, -10.0],
        "return": [0.1, -0.05, 0.2, -0.01],
        "entry_date": pd.to_datetime(["2024-01-01"] * 4),
        "exit_date": pd.to_datetime(["2024-01-11"] * 4),
        "partial_taken": [True, False, True, False],
    })
    s = trade_stats(trades)
    assert s["win_rate"] == 0.5
    assert s["profit_factor"] == pytest.approx(300 / 60)
    assert s["avg_hold_days"] == 10


def test_sector_concentration_flags_single_sector() -> None:
    h = pd.DataFrame({
        "date": pd.to_datetime(["2024-01-31"] * 3),
        "ticker": ["A", "B", "C"],
        "sector": ["Tech", "Tech", "Energy"],
        "value": [40.0, 40.0, 20.0],
        "weight": [0.4, 0.4, 0.2],
    })
    _, s = sector_concentration(h)
    assert s["avg_top_sector_share"] == pytest.approx(0.8)
    assert s["avg_hhi"] == pytest.approx(0.8**2 + 0.2**2)
    assert s["most_common_top_sector"] == "Tech"
