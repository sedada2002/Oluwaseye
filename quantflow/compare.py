"""Run several strategy variants on the same data and compare them side by side.

    quantflow-compare --source free --start 2016-09-01 --out-dir reports/compare

Data is loaded once and shared, so extra variants cost compute, not downloads.
Writes one HTML report per variant plus compare.md / compare.json.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Sequence

import pandas as pd

from quantflow.config import BacktestConfig
from quantflow.data.base import DataProvider
from quantflow.data.factory import SOURCES, ProviderConfigError, Source, make_provider
from quantflow.engine import run_backtest
from quantflow.report import render_html, summarize


@dataclass(frozen=True)
class Variant:
    name: str
    label: str
    min_revenue: float = 0.0
    max_sector_weight: float = 1.0


DEFAULT_VARIANTS = [
    Variant("baseline", "Current screen"),
    Variant("floor", "Revenue > $500M", min_revenue=500e6),
    Variant("cap", "Sector cap 30%", max_sector_weight=0.30),
    Variant("floor_cap", "Revenue > $500M + sector cap 30%", min_revenue=500e6, max_sector_weight=0.30),
]


class MemoProvider:
    """Loads each dataset once. Price requests for a subset of already-loaded tickers
    are served from memory, so variants with stricter screens never re-download."""

    def __init__(self, inner: DataProvider) -> None:
        self._inner = inner
        self._universe: pd.DataFrame | None = None
        self._fund: pd.DataFrame | None = None
        self._prices: pd.DataFrame | None = None
        self._price_key: tuple[set[str], str, str] | None = None
        self._sectors: dict[str, str] = {}
        self.caveats: list[str] = list(getattr(inner, "caveats", []))

    def universe(self) -> pd.DataFrame:
        if self._universe is None:
            self._universe = self._inner.universe()
        return self._universe.copy()

    def fundamentals(self) -> pd.DataFrame:
        if self._fund is None:
            self._fund = self._inner.fundamentals()
        return self._fund.copy()

    def prices(self, tickers: Sequence[str], start: str, end: str) -> pd.DataFrame:
        want = set(tickers)
        if self._prices is not None and self._price_key is not None:
            have, s0, e0 = self._price_key
            if want <= have and s0 <= start and end <= e0:
                px = self._prices
                mask = px["ticker"].isin(want) & px["date"].between(pd.Timestamp(start), pd.Timestamp(end))
                return px[mask].copy()
        self._prices = self._inner.prices(sorted(want), start, end)
        self._price_key = (want, start, end)
        return self._prices.copy()

    def sectors(self, tickers: Sequence[str]) -> dict[str, str]:
        missing = [t for t in tickers if t not in self._sectors]
        if missing:
            self._sectors.update(self._inner.sectors(missing))
        return {t: self._sectors[t] for t in tickers}


def _pct(v: float) -> str:
    return "n/a" if v != v else f"{v:.1%}"


def _num(v: float) -> str:
    return "n/a" if v != v else f"{v:.2f}"


def compare(provider: DataProvider, base: BacktestConfig, variants: list[Variant],
            out_dir: Path, source: Source) -> list[dict[str, object]]:
    memo = MemoProvider(provider)
    out_dir.mkdir(parents=True, exist_ok=True)
    # Run the loosest screen first so its price download covers every stricter variant
    ordered = sorted(variants, key=lambda v: (v.min_revenue, -v.max_sector_weight))
    rows: dict[str, dict[str, object]] = {}
    bench: dict[str, float] = {}
    for v in ordered:
        cfg = replace(base,
                      screen=replace(base.screen, min_revenue=v.min_revenue),
                      risk=replace(base.risk, max_sector_weight=v.max_sector_weight))
        res = run_backtest(memo, cfg)
        d = summarize(res)
        (out_dir / f"{v.name}.html").write_text(
            render_html(res, d, title=f"QuantFlow vs SPY: {v.label}", source=source), encoding="utf-8")
        res.trades.to_csv(out_dir / f"{v.name}.trades.csv", index=False)
        rows[v.name] = {"variant": v.name, "label": v.label, "strategy": d.strategy.as_dict(),
                        "trades": d.trades, "sectors": d.sectors, "relative": d.relative}
        bench = d.benchmark.as_dict()
        print(f"done: {v.label}", file=sys.stderr)

    results = [rows[v.name] for v in variants]
    (out_dir / "compare.json").write_text(
        json.dumps({"benchmark": bench, "variants": results}, indent=2, default=str))
    (out_dir / "compare.md").write_text(_markdown(results, bench))
    return results


def _markdown(results: list[dict[str, object]], bench: dict[str, float]) -> str:
    head = "| | " + " | ".join(str(r["label"]) for r in results) + " | SPY |\n"
    head += "|---" * (len(results) + 2) + "|\n"

    def row(name: str, key: str, fmt: str, src: str = "strategy") -> str:
        vals = []
        for r in results:
            block = r[src]
            assert isinstance(block, dict)
            v = block.get(key, float("nan"))
            vals.append(_pct(v) if fmt == "pct" else _num(v) if fmt == "num" else str(v))
        b = bench.get(key, float("nan")) if src == "strategy" else float("nan")
        bs = "" if src != "strategy" else (_pct(b) if fmt == "pct" else _num(b))
        return f"| {name} | " + " | ".join(vals) + f" | {bs} |\n"

    def int_row(name: str, key: str, src: str) -> str:
        vals = []
        for r in results:
            block = r[src]
            assert isinstance(block, dict)
            v = block.get(key, float("nan"))
            vals.append("n/a" if isinstance(v, float) and math.isnan(v) else f"{float(v):.0f}")
        return f"| {name} | " + " | ".join(vals) + " | |\n"

    body = (
        row("CAGR", "cagr", "pct")
        + row("Sharpe", "sharpe", "num")
        + row("Max drawdown", "max_drawdown", "pct")
        + row("Volatility", "volatility", "pct")
        + int_row("Trades", "trades", "trades")
        + row("Win rate", "win_rate", "pct", "trades")
        + row("Avg loser", "avg_loss", "pct", "trades")
        + row("Top sector, % of invested", "avg_top_sector_share", "pct", "sectors")
        + row("Avg positions held", "avg_positions", "num", "sectors")
        + row("Most common top sector", "most_common_top_sector", "str", "sectors")
    )
    return "## QuantFlow variants vs SPY\n\n" + head + body


def main(argv: list[str] | None = None) -> int:
    from quantflow.cli import FREE_EARLIEST_START, _load_dotenv

    p = argparse.ArgumentParser(prog="quantflow-compare")
    p.add_argument("--source", choices=SOURCES, default="free")
    p.add_argument("--start", default="2016-09-01")
    p.add_argument("--end", default=BacktestConfig.end)
    p.add_argument("--out-dir", default="reports/compare")
    args = p.parse_args(argv)
    source: Source = args.source
    start = max(args.start, FREE_EARLIEST_START) if source == "free" else args.start
    if source != "synthetic":
        _load_dotenv()
    try:
        provider = make_provider(source)
    except ProviderConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    base = BacktestConfig(start=start, end=args.end)
    compare(provider, base, DEFAULT_VARIANTS, Path(args.out_dir), source)
    print((Path(args.out_dir) / "compare.md").read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
