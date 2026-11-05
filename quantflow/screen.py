"""Point-in-time growth screen.

On date `asof` a filing is only visible if its datekey <= asof. Revenue CAGR compares
the latest visible as-reported TTM revenue with the TTM revenue for the same quarter
`cagr_years` earlier (also as filed). No restated numbers, no future filings.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from quantflow.config import ScreenConfig


def _quarter_end(ts: pd.Series) -> pd.Series:
    out: pd.Series = ts.dt.to_period("Q").dt.to_timestamp(how="end").dt.normalize()
    return out


def _with_base(fund: pd.DataFrame, years: int) -> pd.DataFrame:
    """Attach the base-period row (same quarter, `years` earlier) to each fundamental row."""
    f = fund.copy()
    f["q"] = _quarter_end(f["calendardate"])
    f["base_q"] = _quarter_end(f["calendardate"] - pd.DateOffset(years=years))
    base = (
        f[["ticker", "q", "revenue", "datekey"]]
        .sort_values("datekey")
        .drop_duplicates(["ticker", "q"], keep="first")   # original filing, not amendments
        .rename(columns={"q": "base_q", "revenue": "base_revenue", "datekey": "base_datekey"})
    )
    return f.merge(base, on=["ticker", "base_q"], how="left")


def _cagr(rev: pd.Series, base: pd.Series, years: int) -> pd.Series:
    ratio = rev / base
    out = np.where((base > 0) & (rev > 0), ratio ** (1.0 / years) - 1.0, np.nan)
    return pd.Series(out, index=rev.index)


def fundamental_candidates(fund: pd.DataFrame, cfg: ScreenConfig) -> list[str]:
    """Tickers that pass the fundamental legs on at least one filing. A superset of
    every name the screen could ever pick, used to limit price downloads."""
    f = _with_base(fund, cfg.cagr_years)
    f["cagr"] = _cagr(f["revenue"], f["base_revenue"], cfg.cagr_years)
    ok = (f["cagr"] > cfg.min_revenue_cagr) & (f["de"] < cfg.max_debt_to_equity) & (f["de"] >= 0)
    return sorted(f.loc[ok, "ticker"].unique().tolist())


def fundamental_snapshot(fund: pd.DataFrame, asof: pd.Timestamp, cfg: ScreenConfig) -> pd.DataFrame:
    """Latest visible fundamentals per ticker as of `asof`, with point-in-time CAGR."""
    visible = fund[fund["datekey"] <= asof]
    if visible.empty:
        return pd.DataFrame(columns=["ticker", "revenue_cagr", "de", "datekey"])
    latest = (
        visible.sort_values(["calendardate", "datekey"])
        .groupby("ticker", as_index=False)
        .tail(1)
    )
    latest = latest[(asof - latest["datekey"]).dt.days <= cfg.max_staleness_days]
    f = latest.copy()
    f["base_q"] = _quarter_end(f["calendardate"] - pd.DateOffset(years=cfg.cagr_years))
    # the base-period filing must also have been public by asof
    base = visible[["ticker", "calendardate", "revenue", "datekey"]].copy()
    base["q"] = _quarter_end(base["calendardate"])
    base = (
        base.sort_values("datekey")
        .drop_duplicates(["ticker", "q"], keep="first")
        .rename(columns={"q": "base_q", "revenue": "base_revenue", "datekey": "base_datekey"})
        [["ticker", "base_q", "base_revenue", "base_datekey"]]
    )
    f = f.merge(base, on=["ticker", "base_q"], how="left")
    f["revenue_cagr"] = _cagr(f["revenue"], f["base_revenue"], cfg.cagr_years)
    out: pd.DataFrame = f[["ticker", "revenue_cagr", "de", "datekey"]].reset_index(drop=True)
    return out


def relative_strength(
    closes: pd.DataFrame, benchmark: pd.Series, asof: pd.Timestamp, lookback: int
) -> pd.Series:
    """Excess return vs benchmark over `lookback` sessions ending at `asof`.
    Only names that actually traded on `asof` get a value."""
    idx = closes.index
    if asof not in idx:
        return pd.Series(dtype=float)
    pos = idx.get_loc(asof)
    if not isinstance(pos, int) or pos < lookback:
        return pd.Series(dtype=float)
    then = idx[pos - lookback]
    r = closes.loc[asof] / closes.loc[then] - 1.0
    rb = float(benchmark.loc[asof] / benchmark.loc[then] - 1.0)
    excess: pd.Series = (r - rb).dropna()
    return excess


def run_screen(
    fund: pd.DataFrame,
    closes: pd.DataFrame,
    benchmark: pd.Series,
    asof: pd.Timestamp,
    cfg: ScreenConfig,
) -> pd.DataFrame:
    """Names passing all three legs on `asof`, ranked by relative strength (best first)."""
    snap = fundamental_snapshot(fund, asof, cfg)
    snap = snap[
        (snap["revenue_cagr"] > cfg.min_revenue_cagr)
        & (snap["de"] >= 0)
        & (snap["de"] < cfg.max_debt_to_equity)
    ]
    rs = relative_strength(closes, benchmark, asof, cfg.rs_lookback_days).rename("rs_excess")
    out = snap.merge(rs, left_on="ticker", right_index=True, how="inner")
    out = out[out["rs_excess"] > cfg.min_rs_excess]
    return out.sort_values("rs_excess", ascending=False).reset_index(drop=True)
