"""Command line entry point.

    quantflow --source free --start 2016-07-01 --out reports/free.html   # SEC + Alpaca, $0
    quantflow --source sharadar --start 2012-01-01 --out reports/sharadar.html
    quantflow --source synthetic --out reports/dry_run.html             # no keys, mechanics only
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

from quantflow.config import BacktestConfig, RiskConfig, ScreenConfig
from quantflow.data.factory import SOURCES, ProviderConfigError, Source, make_provider
from quantflow.engine import run_backtest
from quantflow.report import render_html, summarize

FREE_EARLIEST_START = "2016-09-01"   # 2016 data start + RS/ATR warm-up


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
    p.add_argument("--min-revenue", type=float, default=ScreenConfig.min_revenue,
                   help="TTM revenue floor in USD, e.g. 500e6")
    p.add_argument("--max-sector-weight", type=float, default=RiskConfig.max_sector_weight,
                   help="max share of equity in one sector, e.g. 0.3 (1.0 = no cap)")
    p.add_argument("--source", choices=SOURCES, default="free",
                   help="free = SEC EDGAR + Alpaca; sharadar = paid; synthetic = fake data")
    p.add_argument("--synthetic", action="store_true", help="shorthand for --source synthetic")
    p.add_argument("--out", default="reports/quantflow_vs_spy.html")
    args = p.parse_args(argv)

    cfg = BacktestConfig(
        start=args.start, end=args.end, initial_equity=args.equity,
        exit_on_screen_fail=args.exit_on_screen_fail,
        screen=replace(ScreenConfig(), rs_lookback_days=args.rs_lookback, min_revenue=args.min_revenue),
        risk=replace(RiskConfig(), max_positions=args.max_positions, atr_multiplier=args.atr_mult,
                     max_sector_weight=args.max_sector_weight),
    )

    source: Source = "synthetic" if args.synthetic else args.source
    if source == "free" and args.start < FREE_EARLIEST_START:
        print(f"note: Alpaca history starts 2016; moving start to {FREE_EARLIEST_START}", file=sys.stderr)
        cfg = replace(cfg, start=FREE_EARLIEST_START)
    if source != "synthetic":
        _load_dotenv()
    try:
        provider = make_provider(source)
    except ProviderConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    result = run_backtest(provider, cfg)
    data = summarize(result)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_html(result, data, source=source), encoding="utf-8")
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
