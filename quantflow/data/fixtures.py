"""Deterministic synthetic provider for tests and offline dry runs.

Not market data. Use it to check the engine's mechanics, never to judge the strategy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
import pandas as pd

from quantflow.data.base import (
    FUNDAMENTAL_COLUMNS,
    PRICE_COLUMNS,
    UNIVERSE_COLUMNS,
    sectors_from_universe,
)

SECTORS = ["Technology", "Healthcare", "Industrials", "Consumer Cyclical", "Energy"]


@dataclass
class SyntheticProvider:
    n_tickers: int = 40
    start: str = "2012-01-02"
    end: str = "2026-10-30"
    seed: int = 7
    filing_lag_days: int = 45
    _cache: dict[str, pd.DataFrame] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        rng = np.random.default_rng(self.seed)
        dates = pd.bdate_range(self.start, self.end)
        tickers = [f"T{i:03d}" for i in range(self.n_tickers)]

        price_rows: list[pd.DataFrame] = []
        fund_rows: list[dict[str, object]] = []
        uni_rows: list[dict[str, object]] = []

        price_rows.append(self._path("SPY", dates, 0.08, 0.17, 300.0, rng))

        quarters = pd.date_range(self.start, self.end, freq="QE")
        for i, t in enumerate(tickers):
            growth = rng.choice([0.05, 0.12, 0.30, 0.45])          # annual revenue growth
            drift = 0.02 + 0.6 * growth + rng.normal(0, 0.05)
            vol = rng.uniform(0.25, 0.55)
            delist_at = len(dates)
            if i % 13 == 5:                                         # some names die
                delist_at = int(rng.integers(len(dates) // 3, len(dates) - 50))
            path = self._path(t, dates[:delist_at], drift, vol, rng.uniform(10, 80), rng)
            price_rows.append(path)

            revenue = rng.uniform(200e6, 2e9)
            de = float(rng.choice([0.1, 0.3, 0.8, 1.5]))
            last_px_date = path["date"].max()
            for q in quarters:
                datekey = q + pd.Timedelta(days=self.filing_lag_days)
                if datekey > last_px_date:
                    break
                revenue *= (1 + growth) ** 0.25 * (1 + rng.normal(0, 0.02))
                fund_rows.append(
                    {
                        "ticker": t,
                        "calendardate": q,
                        "datekey": datekey,
                        "revenue": revenue,
                        "de": max(0.0, de + rng.normal(0, 0.05)),
                    }
                )
            uni_rows.append(
                {
                    "ticker": t,
                    "sector": SECTORS[i % len(SECTORS)],
                    "isdelisted": delist_at < len(dates),
                }
            )

        self._cache["prices"] = pd.concat(price_rows, ignore_index=True)[PRICE_COLUMNS]
        self._cache["fundamentals"] = pd.DataFrame(fund_rows)[FUNDAMENTAL_COLUMNS]
        self._cache["universe"] = pd.DataFrame(uni_rows)[UNIVERSE_COLUMNS]

    @staticmethod
    def _path(
        ticker: str,
        dates: pd.DatetimeIndex,
        drift: float,
        vol: float,
        start_px: float,
        rng: np.random.Generator,
    ) -> pd.DataFrame:
        n = len(dates)
        dt = 1 / 252
        rets = rng.normal((drift - 0.5 * vol**2) * dt, vol * np.sqrt(dt), n)
        close = start_px * np.exp(np.cumsum(rets))
        prev = np.concatenate([[start_px], close[:-1]])
        open_ = prev * np.exp(rng.normal(0, vol * np.sqrt(dt) * 0.3, n))
        hi = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, vol * np.sqrt(dt) * 0.5, n)))
        lo = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, vol * np.sqrt(dt) * 0.5, n)))
        return pd.DataFrame(
            {"ticker": ticker, "date": dates, "open": open_, "high": hi, "low": lo, "close": close}
        )

    def universe(self) -> pd.DataFrame:
        return self._cache["universe"].copy()

    def fundamentals(self) -> pd.DataFrame:
        return self._cache["fundamentals"].copy()

    def sectors(self, tickers: Sequence[str]) -> dict[str, str]:
        return sectors_from_universe(self.universe(), tickers)

    def prices(self, tickers: Sequence[str], start: str, end: str) -> pd.DataFrame:
        p = self._cache["prices"]
        mask = p["ticker"].isin(list(tickers)) & p["date"].between(start, end)
        return p[mask].copy()
