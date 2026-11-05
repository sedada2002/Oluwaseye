"""Free provider wiring: EDGAR-shaped fundamentals + Alpaca-shaped prices through the engine."""

from __future__ import annotations

from typing import Sequence

import pandas as pd

from quantflow.config import BacktestConfig
from quantflow.data.fixtures import SyntheticProvider
from quantflow.data.free import CAVEATS, FreeProvider
from quantflow.engine import run_backtest
from quantflow.report import render_html


class FakeEdgar:
    def __init__(self, base: SyntheticProvider) -> None:
        self.base = base

    def universe(self) -> pd.DataFrame:
        return self.base.universe().assign(sector="Unknown")   # EDGAR has no sector up front

    def fundamentals(self) -> pd.DataFrame:
        return self.base.fundamentals()

    def sectors(self, tickers: Sequence[str]) -> dict[str, str]:
        return self.base.sectors(tickers)


class FakeAlpaca:
    def __init__(self, base: SyntheticProvider) -> None:
        self.base = base

    def prices(self, tickers: Sequence[str], start: str, end: str) -> pd.DataFrame:
        return self.base.prices(tickers, max(start, "2016-01-01"), end)


def test_free_provider_end_to_end() -> None:
    base = SyntheticProvider()
    p = FreeProvider(FakeEdgar(base), FakeAlpaca(base))  # type: ignore[arg-type]
    res = run_backtest(p, BacktestConfig(start="2016-09-01", end="2020-12-31"))
    assert not res.trades.empty
    assert set(res.trades["sector"]) != {"Unknown"}           # sectors came via sectors()
    assert res.notes[: len(CAVEATS)] == CAVEATS
    html = render_html(res, source="free")
    assert "survivorship" in html and "Data from Sharadar" not in html
