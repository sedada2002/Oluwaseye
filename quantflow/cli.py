"""Command line entry point.

    quantflow --start 2012-01-01 --end 2026-10-31 --out reports/quantflow_vs_spy.html
    quantflow --synthetic --out reports/dry_run.html     # no key needed, mechanics only
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

from quantflow.config import BacktestConfig, RiskConfig, ScreenConfig
from quantflow.data.base import DataProvider
from quantflow.engine import run_backtest
from quantflow.report import render_html, summarize


def _load_dotenv(path: Path = Path(".env")) -> None:
    """Minimal .env loader so the key never has to be typed on the command line."""
    import os

    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="quantflow")
    p.add_argument("--start", default=BacktestConfig.start)
    p.add_argument("--end", default=BacktestConfig.end)
    p.add_argument("--equity", type=float, default=BacktestConfig.initial_equity)
    p.add_argument("--max-positions", type=int, default=RiskConfig.max_positions)
    p.add_argument("--atr-mult", type=float, default=RiskConfig.atr_multiplier)
    p.add_argument("--rs-lookback", type=int, default=ScreenConfig.rs_lookback_days)
    p.add_argument("--exit-on-screen-fail", action="store_true")
    p.add_argument("--synthetic", action="store_true", help="use fake data (no API key)")
    p.add_argument("--out", default="reports/quantflow_vs_spy.html")
    args = p.parse_args(argv)

    cfg = BacktestConfig(
        start=args.start, end=args.end, initial_equity=args.equity,
        exit_on_screen_fail=args.exit_on_screen_fail,
        screen=replace(ScreenConfig(), rs_lookback_days=args.rs_lookback),
        risk=replace(RiskConfig(), max_positions=args.max_positions, atr_multiplier=args.atr_mult),
    )

    provider: DataProvider
    if args.synthetic:
        from quantflow.data.fixtures import SyntheticProvider

        provider = SyntheticProvider()
    else:
        _load_dotenv()
        from quantflow.data.sharadar import SharadarProvider, SharadarError

        try:
            provider = SharadarProvider()
        except SharadarError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2

    result = run_backtest(provider, cfg)
    data = summarize(result)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_html(result, data, synthetic=args.synthetic), encoding="utf-8")
    result.trades.to_csv(out.with_suffix(".trades.csv"), index=False)
    if not result.screens.empty:
        result.screens.to_csv(out.with_suffix(".screens.csv"), index=False)

    print(json.dumps({
        "report": str(out),
        "strategy": data.strategy.as_dict(),
        "benchmark": data.benchmark.as_dict(),
        "trades": data.trades,
        "sectors": data.sectors,
    }, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
