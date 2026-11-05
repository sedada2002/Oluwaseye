"""Provider contract. The engine only ever talks to this interface.

Frame schemas (all dates are pandas Timestamps, naive, exchange-local):

fundamentals(): one row per (ticker, calendardate) of AS-REPORTED trailing-twelve-month data
    ticker, calendardate, datekey, revenue, de
    `datekey` is the date the filing became public. The screen may only use a row on
    or after its datekey - this is the point-in-time guarantee.

prices(tickers): daily split-adjusted bars
    ticker, date, open, high, low, close

universe(): one row per ticker
    ticker, sector, isdelisted

sectors(tickers): {ticker: sector} - only called for tickers that can pass the screen,
    so providers where sector lookup is expensive (EDGAR) do it lazily.
"""

from __future__ import annotations

from typing import Protocol, Sequence

import pandas as pd

FUNDAMENTAL_COLUMNS = ["ticker", "calendardate", "datekey", "revenue", "de"]
PRICE_COLUMNS = ["ticker", "date", "open", "high", "low", "close"]
UNIVERSE_COLUMNS = ["ticker", "sector", "isdelisted"]


class DataProvider(Protocol):
    def universe(self) -> pd.DataFrame: ...

    def fundamentals(self) -> pd.DataFrame: ...

    def prices(self, tickers: Sequence[str], start: str, end: str) -> pd.DataFrame: ...

    def sectors(self, tickers: Sequence[str]) -> dict[str, str]: ...


def sectors_from_universe(universe: pd.DataFrame, tickers: Sequence[str]) -> dict[str, str]:
    lookup = dict(zip(universe["ticker"].astype(str), universe["sector"].astype(str)))
    return {t: lookup.get(t, "Unknown") for t in tickers}


def validate(df: pd.DataFrame, columns: list[str], name: str) -> pd.DataFrame:
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise ValueError(f"{name} frame missing columns: {missing}")
    return df[columns].copy()
