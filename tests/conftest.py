from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
import pandas as pd


@dataclass
class MiniProvider:
    """Hand-built single-stock world so every fill can be checked by hand."""

    closes: pd.Series                    # stock close path, indexed by date
    spy: pd.Series
    ticker: str = "GRO"
    spread: float = 1.0                  # high = close + spread, low = close - spread
    fundamentals_df: pd.DataFrame = field(default_factory=pd.DataFrame)

    def universe(self) -> pd.DataFrame:
        return pd.DataFrame({"ticker": [self.ticker], "sector": ["Technology"], "isdelisted": [False]})

    def fundamentals(self) -> pd.DataFrame:
        return self.fundamentals_df.copy()

    def sectors(self, tickers: Sequence[str]) -> dict[str, str]:
        return {t: "Technology" for t in tickers}

    def prices(self, tickers: Sequence[str], start: str, end: str) -> pd.DataFrame:
        frames = []
        for t, s in ((self.ticker, self.closes), ("SPY", self.spy)):
            if t not in tickers:
                continue
            prev = s.shift(1).fillna(s.iloc[0])
            frames.append(pd.DataFrame({
                "ticker": t, "date": s.index, "open": prev.to_numpy(),
                "high": (np.maximum(prev, s) + self.spread).to_numpy(),
                "low": (np.minimum(prev, s) - self.spread).to_numpy(),
                "close": s.to_numpy(),
            }))
        df = pd.concat(frames, ignore_index=True)
        return df[df["date"].between(start, end)]


def growth_fundamentals(ticker: str, start: str, end: str, growth: float = 0.4) -> pd.DataFrame:
    rows = []
    rev = 100e6
    for q in pd.date_range(start, end, freq="QE"):
        rev *= (1 + growth) ** 0.25
        rows.append({"ticker": ticker, "calendardate": q, "datekey": q + pd.Timedelta(days=40),
                     "revenue": rev, "de": 0.2})
    return pd.DataFrame(rows)
