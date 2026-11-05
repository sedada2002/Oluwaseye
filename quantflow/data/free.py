"""Zero-cost provider: SEC EDGAR fundamentals + Alpaca prices.

Good enough to find out whether the screen is worth paying for. Not good enough to
trust a final number: today's-listings universe and patchy delisted prices mean
survivorship bias, and history starts in 2016.
"""

from __future__ import annotations

from typing import Sequence

import pandas as pd

from quantflow.data.alpaca import AlpacaPrices
from quantflow.data.edgar import EdgarFundamentals

CAVEATS = [
    "FREE DATA: universe is companies listed today (SEC ticker file) and Alpaca covers few "
    "delisted names, so failed companies are missing. This survivorship bias flatters the "
    "strategy; confirm any edge on survivorship-free data before trusting it.",
    "Fundamentals from SEC XBRL as originally filed (earliest 'filed' date); price history from 2016.",
]


class FreeProvider:
    caveats = CAVEATS

    def __init__(self, fundamentals: EdgarFundamentals | None = None,
                 prices_source: AlpacaPrices | None = None) -> None:
        self._edgar = fundamentals or EdgarFundamentals()
        self._alpaca = prices_source or AlpacaPrices()

    def universe(self) -> pd.DataFrame:
        return self._edgar.universe()

    def fundamentals(self) -> pd.DataFrame:
        return self._edgar.fundamentals()

    def prices(self, tickers: Sequence[str], start: str, end: str) -> pd.DataFrame:
        return self._alpaca.prices(tickers, start, end)

    def sectors(self, tickers: Sequence[str]) -> dict[str, str]:
        return self._edgar.sectors(tickers)
