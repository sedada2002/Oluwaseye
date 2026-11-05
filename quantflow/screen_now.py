"""Today's screen results, with the numbers behind each name.

    quantflow-screen --strategy growth_momentum --backtest

Lists every stock passing the strategy today, ranked, with revenue, growth, debt,
momentum, sector, and an example position size and stop under the project's risk rules
(1% equity risk per trade, 3xATR stop, max 10% per name). Optionally backtests the
same rule so the list comes with its track record.

Screen output for research, not a recommendation.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import pandas as pd

from quantflow.config import BacktestConfig, RiskConfig, ScreenConfig
from quantflow.data.base import DataProvider
from quantflow.engine import run_backtest
from quantflow.indicators import atr
from quantflow.metrics import performance
from quantflow.screen import fundamental_snapshot
from quantflow.signals import HISTORY_BDAYS
from quantflow.strategies import by_name


def screen_today(provider: DataProvider, strategy_name: str, equity: float = 100_000.0,
                 asof: str | None = None, benchmark: str = "SPY",
                 risk: RiskConfig | None = None) -> tuple[pd.Timestamp, pd.DataFrame]:
    risk = risk or RiskConfig()
    strat = by_name(strategy_name)
    end = asof or pd.Timestamp.today().strftime("%Y-%m-%d")
    start = (pd.Timestamp(end) - pd.tseries.offsets.BDay(HISTORY_BDAYS)).strftime("%Y-%m-%d")
    fund = provider.fundamentals()
    cands = strat.candidates(fund)
    prices = provider.prices(sorted(set(cands) | {benchmark}), start, end)
    day = pd.Timestamp(prices.loc[prices["ticker"] == benchmark, "date"].max())
    prices = prices[prices["date"] <= day]
    wide = {c: prices.pivot_table(index="date", columns="ticker", values=c).sort_index()
            for c in ("high", "low", "close")}
    closes = wide["close"]
    bench = closes[benchmark]
    picks = strat.select(fund, closes.drop(columns=[benchmark]), bench, day)
    if picks.empty:
        return day, picks

    snap_rows: dict[str, dict[str, Any]] = {
        str(rec["ticker"]): {str(k): v for k, v in rec.items()}
        for rec in fundamental_snapshot(fund, day, ScreenConfig()).to_dict(orient="records")}
    sectors = provider.sectors(list(picks["ticker"]))
    rows = []
    for rank, r in enumerate(picks.itertuples(index=False), start=1):
        t = str(r.ticker)
        px = float(closes[t].dropna().iloc[-1])
        a = float(atr(wide["high"][t], wide["low"][t], closes[t], risk.atr_period).dropna().iloc[-1])
        dist = risk.atr_multiplier * a
        shares = min(math.floor(risk.risk_per_trade * equity / dist),
                     math.floor(risk.max_position_weight * equity / px)) if dist > 0 else 0
        f = snap_rows.get(t)
        rows.append({
            "rank": rank, "ticker": t, "sector": sectors.get(t, "Unknown"), "close": px,
            "revenue_ttm": float(f["revenue"]) if f is not None else float("nan"),
            "revenue_cagr_3y": float(f["revenue_cagr"]) if f is not None else float("nan"),
            "debt_to_equity": float(f["de"]) if f is not None else float("nan"),
            "rs_vs_spy_6m": float(getattr(r, "rs_excess", float("nan"))),
            "momentum_12_1": float(getattr(r, "momentum", float("nan"))),
            "stop": px - dist, "stop_pct": dist / px, "target_plus20": px * (1 + risk.partial_target),
            "example_shares": shares, "example_cost": shares * px,
            "last_filing": f["datekey"].strftime("%Y-%m-%d") if f is not None else "",
        })
    return day, pd.DataFrame(rows)


def to_markdown(day: pd.Timestamp, label: str, df: pd.DataFrame, equity: float,
                track: dict[str, dict[str, float]] | None, top: int = 25,
                data_label: str = "free data, survivorship-biased") -> str:
    def pct(v: float) -> str:
        return "n/a" if v != v else f"{v:.0%}"

    lines = [f"## {label}: screen results for {day:%Y-%m-%d}", ""]
    if df.empty:
        lines.append("**No stocks pass the screen today.**")
    else:
        lines += [f"{len(df)} stocks pass. Showing the top {min(top, len(df))} by 12-1 momentum. "
                  f"Example sizes assume a ${equity:,.0f} account and the 1%-risk rule.", "",
                  "| # | Ticker | Sector | Close | Revenue (TTM) | 3y rev CAGR | D/E | 6m vs SPY | 12-1 mom | "
                  "Stop (3×ATR) | Example size |",
                  "|---|---|---|---|---|---|---|---|---|---|---|"]
        records = [{str(k): v for k, v in rec.items()} for rec in df.head(top).to_dict(orient="records")]
        for r in records:
            lines.append(
                f"| {r['rank']} | **{r['ticker']}** | {r['sector']} | ${r['close']:,.2f} | "
                f"${r['revenue_ttm'] / 1e9:,.1f}B | {pct(r['revenue_cagr_3y'])} | {r['debt_to_equity']:.2f} | "
                f"{pct(r['rs_vs_spy_6m'])} | {pct(r['momentum_12_1'])} | "
                f"${r['stop']:,.2f} (−{r['stop_pct']:.0%}) | "
                f"{r['example_shares']} sh ≈ ${r['example_cost']:,.0f} |")
        sec = df["sector"].value_counts()
        lines += ["", "Sector mix: " + ", ".join(f"{k} {v}" for k, v in sec.items())]
    if track:
        s, b = track["strategy"], track["benchmark"]
        lines += ["", f"### How this exact rule did ({data_label})", "",
                  "| | This screen | SPY |", "|---|---|---|",
                  f"| Annual return | {s['cagr']:.1%} | {b['cagr']:.1%} |",
                  f"| Sharpe | {s['sharpe']:.2f} | {b['sharpe']:.2f} |",
                  f"| Max drawdown | {s['max_drawdown']:.1%} | {b['max_drawdown']:.1%} |",
                  "", "This rule was added after the tournament, so this is information, not a fair contest."]
    lines += ["", "_Screen output for research, not investment advice. Check each company yourself._"]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    from quantflow.cli import FREE_EARLIEST_START, _load_dotenv
    from quantflow.data.factory import SOURCES, ProviderConfigError, Source, make_provider

    p = argparse.ArgumentParser(prog="quantflow-screen")
    p.add_argument("--strategy", default="growth_momentum")
    p.add_argument("--source", choices=SOURCES, default="free")
    p.add_argument("--equity", type=float, default=100_000.0)
    p.add_argument("--asof")
    p.add_argument("--backtest", action="store_true", help="also backtest this rule vs SPY")
    p.add_argument("--out-dir", default="reports/screen")
    args = p.parse_args(argv)
    source: Source = args.source
    if source != "synthetic":
        _load_dotenv()
    try:
        provider = make_provider(source, fresh=True)
    except ProviderConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    strat = by_name(args.strategy)
    day, df = screen_today(provider, args.strategy, args.equity, args.asof)
    track = None
    if args.backtest:
        start = FREE_EARLIEST_START if source == "free" else "2012-01-01"
        end = (day - pd.offsets.MonthEnd(1)).strftime("%Y-%m-%d")
        res = run_backtest(provider, BacktestConfig(start=start, end=end), strat)
        track = {"strategy": performance(res.equity).as_dict(),
                 "benchmark": performance(res.benchmark).as_dict()}
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    data_label = {"free": "free data, survivorship-biased", "sharadar": "Sharadar data",
                  "synthetic": "SYNTHETIC data, meaningless"}[source]
    md = to_markdown(day, strat.label, df, args.equity, track, data_label=data_label)
    (out / "screen.md").write_text(md)
    df.to_csv(out / "screen.csv", index=False)
    (out / "screen.json").write_text(json.dumps({"date": f"{day:%Y-%m-%d}", "strategy": strat.name,
                                                 "track_record": track,
                                                 "picks": df.to_dict(orient="records")}, indent=2, default=str))
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
