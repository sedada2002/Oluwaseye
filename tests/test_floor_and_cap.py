from dataclasses import replace

import pandas as pd

from quantflow.compare import DEFAULT_VARIANTS, MemoProvider, compare
from quantflow.config import BacktestConfig, RiskConfig, ScreenConfig
from quantflow.data.fixtures import SyntheticProvider
from quantflow.engine import run_backtest
from quantflow.screen import fundamental_candidates, fundamental_snapshot


def _rows(rev_now: float, t: str = "AAA") -> pd.DataFrame:
    return pd.DataFrame([
        {"ticker": t, "calendardate": pd.Timestamp("2020-12-31"), "datekey": pd.Timestamp("2021-02-15"),
         "revenue": rev_now / 3, "de": 0.2},
        {"ticker": t, "calendardate": pd.Timestamp("2023-12-31"), "datekey": pd.Timestamp("2024-02-15"),
         "revenue": rev_now, "de": 0.2},
    ])


def test_revenue_floor_excludes_small_companies() -> None:
    fund = pd.concat([_rows(50e6, "TINY"), _rows(900e6, "BIG")])
    cfg = replace(ScreenConfig(), min_revenue=500e6)
    assert fundamental_candidates(fund, cfg) == ["BIG"]
    snap = fundamental_snapshot(fund, pd.Timestamp("2024-03-01"), cfg)
    assert set(snap["ticker"]) == {"TINY", "BIG"}          # snapshot keeps both, with revenue
    assert snap.set_index("ticker").loc["TINY", "revenue"] == 50e6


def test_sector_cap_limits_exposure() -> None:
    base = BacktestConfig(start="2015-01-01", end="2020-12-31")
    capped = replace(base, risk=replace(RiskConfig(), max_sector_weight=0.15))
    p = SyntheticProvider()
    res = run_backtest(p, capped)
    by = res.holdings.groupby(["date", "sector"])["weight"].sum()
    # Measured at month-end closes, so allow price drift above the entry-time cap
    assert by.max() < 0.15 * 1.6
    uncapped = run_backtest(p, base).holdings.groupby(["date", "sector"])["weight"].sum()
    assert uncapped.max() > by.max()


def test_memo_provider_reuses_price_superset() -> None:
    calls: list[int] = []

    class Counting(SyntheticProvider):
        def prices(self, tickers, start, end):  # type: ignore[no-untyped-def]
            calls.append(len(tickers))
            return super().prices(tickers, start, end)

    m = MemoProvider(Counting())
    m.prices(["T001", "T002", "SPY"], "2015-01-01", "2016-01-01")
    sub = m.prices(["T001", "SPY"], "2015-01-01", "2016-01-01")
    assert calls == [3] and set(sub["ticker"]) == {"T001", "SPY"}


def test_compare_writes_table(tmp_path) -> None:  # type: ignore[no-untyped-def]
    res = compare(SyntheticProvider(), BacktestConfig(start="2015-01-01", end="2019-12-31"),
                  DEFAULT_VARIANTS, tmp_path, "synthetic")
    assert [r["variant"] for r in res] == [v.name for v in DEFAULT_VARIANTS]
    md = (tmp_path / "compare.md").read_text()
    assert "Revenue > $500M" in md and "Sharpe" in md
    assert (tmp_path / "floor_cap.html").exists()
