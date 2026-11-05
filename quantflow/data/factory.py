"""Pick a data source by name. Keys are read from the environment inside each provider."""

from __future__ import annotations

from typing import Literal

from quantflow.data.base import DataProvider

Source = Literal["free", "sharadar", "synthetic"]
SOURCES: tuple[Source, ...] = ("free", "sharadar", "synthetic")


class ProviderConfigError(RuntimeError):
    pass


def make_provider(source: Source, fresh: bool = False) -> DataProvider:
    """fresh=True (live signals): refresh fundamentals weekly instead of caching forever."""
    if source == "synthetic":
        from quantflow.data.fixtures import SyntheticProvider

        return SyntheticProvider()
    if source == "sharadar":
        from quantflow.data.sharadar import SharadarError, SharadarProvider

        try:
            return SharadarProvider(max_age_days=1 if fresh else None)
        except SharadarError as e:
            raise ProviderConfigError(str(e)) from e
    if source == "free":
        from quantflow.data.alpaca import AlpacaError
        from quantflow.data.edgar import EdgarError, EdgarFundamentals
        from quantflow.data.free import FreeProvider

        try:
            return FreeProvider(EdgarFundamentals(facts_max_age_days=7 if fresh else None))
        except (EdgarError, AlpacaError) as e:
            raise ProviderConfigError(str(e)) from e
    raise ProviderConfigError(f"Unknown data source {source!r}; choose from {SOURCES}")


def source_line(source: Source) -> str:
    """Attribution / honesty line for the report footer (HTML)."""
    return {
        "sharadar": '<a href="http://www.sharadar.com">Data from Sharadar</a>.',
        "free": "Fundamentals: SEC EDGAR XBRL. Prices: Alpaca. <b>Free data - survivorship-biased; "
                "treat results as a go/no-go signal, not a final number.</b>",
        "synthetic": "<b>SYNTHETIC DATA - mechanics check only, these numbers say nothing about "
                     "the strategy.</b>",
    }[source]
