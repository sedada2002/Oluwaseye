import pandas as pd
import pytest

from quantflow.config import ScreenConfig
from quantflow.screen import fundamental_snapshot, relative_strength, run_screen

CFG = ScreenConfig()


def _row(cal: str, datekey: str, rev: float, de: float = 0.2, t: str = "AAA") -> dict[str, object]:
    return {"ticker": t, "calendardate": pd.Timestamp(cal), "datekey": pd.Timestamp(datekey),
            "revenue": rev, "de": de}


def test_filing_not_visible_before_its_datekey() -> None:
    fund = pd.DataFrame([
        _row("2020-12-31", "2021-02-15", 100.0),
        _row("2023-12-31", "2024-02-15", 300.0),     # strong growth, but filed Feb 15
    ])
    before = fundamental_snapshot(fund, pd.Timestamp("2024-02-14"), CFG)
    after = fundamental_snapshot(fund, pd.Timestamp("2024-02-15"), CFG)
    # Day before the filing: latest visible row is the 2020 one, which is stale -> excluded
    assert before.empty
    assert after.loc[0, "revenue_cagr"] == pytest.approx(3 ** (1 / 3) - 1)


def test_base_period_must_also_be_public() -> None:
    # Base filing published late (amended) - not usable before its own datekey
    fund = pd.DataFrame([
        _row("2020-12-31", "2024-06-01", 100.0),
        _row("2023-12-31", "2024-02-15", 300.0),
    ])
    snap = fundamental_snapshot(fund, pd.Timestamp("2024-03-01"), CFG)
    assert snap["revenue_cagr"].isna().all()


def test_original_filing_wins_over_later_amendment() -> None:
    fund = pd.DataFrame([
        _row("2020-12-31", "2021-02-15", 100.0),
        _row("2020-12-31", "2023-01-10", 50.0),       # later restatement-like row
        _row("2023-12-31", "2024-02-15", 300.0),
    ])
    snap = fundamental_snapshot(fund, pd.Timestamp("2024-03-01"), CFG)
    assert snap.loc[0, "revenue_cagr"] == pytest.approx(3 ** (1 / 3) - 1)


def test_stale_filings_dropped() -> None:
    fund = pd.DataFrame([
        _row("2020-12-31", "2021-02-15", 100.0),
        _row("2023-12-31", "2024-02-15", 300.0),
    ])
    snap = fundamental_snapshot(fund, pd.Timestamp("2025-06-01"), CFG)  # >200 days later
    assert snap.empty


def test_relative_strength_uses_only_data_through_asof() -> None:
    idx = pd.bdate_range("2024-01-01", periods=10)
    closes = pd.DataFrame({"AAA": [100.0] * 5 + [120.0] * 5}, index=idx)
    spy = pd.Series([100.0] * 10, index=idx)
    # Jump happens on day 5; as of day 4 RS must still be zero
    assert relative_strength(closes, spy, idx[4], 3).loc["AAA"] == pytest.approx(0.0)
    assert relative_strength(closes, spy, idx[6], 3).loc["AAA"] == pytest.approx(0.2)


def test_run_screen_applies_all_three_legs() -> None:
    idx = pd.bdate_range("2023-06-01", "2024-03-29")
    asof = idx[-1]
    fund = pd.DataFrame([
        _row("2020-12-31", "2021-02-15", 100.0, t="WIN"),
        _row("2023-12-31", "2024-02-15", 300.0, t="WIN"),
        _row("2020-12-31", "2021-02-15", 100.0, t="LEV"),
        _row("2023-12-31", "2024-02-15", 300.0, de=0.9, t="LEV"),   # fails D/E
        _row("2020-12-31", "2021-02-15", 100.0, t="LAG"),
        _row("2023-12-31", "2024-02-15", 300.0, t="LAG"),           # fails RS
    ])
    n = len(idx)
    closes = pd.DataFrame({
        "WIN": [100 + i for i in range(n)],
        "LEV": [100 + i for i in range(n)],
        "LAG": [100.0] * n,
    }, index=idx, dtype=float)
    spy = pd.Series([100 + 0.1 * i for i in range(n)], index=idx)
    picks = run_screen(fund, closes, spy, asof, CFG)
    assert picks["ticker"].tolist() == ["WIN"]
