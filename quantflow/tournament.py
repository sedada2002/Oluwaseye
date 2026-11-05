"""Strategy tournament with an out-of-sample holdout.

    quantflow-tournament --source free --out-dir reports/tournament

1. SELECTION window (default 2016-09 to 2022-12): every strategy runs. The winner is
   chosen by the rule below, fixed in code before any results are seen.
2. HOLDOUT window (default 2023-01 to 2026-10): every strategy runs again on years the
   selection never saw. The winner is CONFIRMED only if it still beats SPY's Sharpe there.

Selection rule:
  - eligible = Sharpe above SPY's AND max drawdown no more than 10 points worse than SPY's
  - winner   = eligible strategy with the highest Sharpe
  - if nothing is eligible, the winner is SPY itself (buy the index)
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from quantflow.compare import MemoProvider
from quantflow.config import BacktestConfig
from quantflow.data.base import DataProvider
from quantflow.data.factory import SOURCES, ProviderConfigError, Source, make_provider
from quantflow.engine import run_backtest
from quantflow.metrics import Performance, performance, trade_stats
from quantflow.report import render_html, summarize
from quantflow.strategies import library, spy_trend_equity

MAX_DD_SLACK = 0.10


@dataclass(frozen=True)
class Window:
    name: str
    start: str
    end: str


@dataclass
class Score:
    strategy: str
    label: str
    window: str
    perf: Performance
    trades: float


def eligible(s: Performance, spy: Performance) -> bool:
    return s.sharpe > spy.sharpe and s.max_drawdown >= spy.max_drawdown - MAX_DD_SLACK


def pick_winner(scores: list[Score], spy: Performance) -> str:
    ok = [s for s in scores if eligible(s.perf, spy)]
    return max(ok, key=lambda s: s.perf.sharpe).strategy if ok else "spy"


def run_window(memo: DataProvider, w: Window, out_dir: Path, source: Source,
               base: BacktestConfig) -> tuple[list[Score], Performance]:
    scores: list[Score] = []
    spy_perf: Performance | None = None
    bench_px: pd.Series | None = None
    for strat in library():
        cfg = BacktestConfig(start=w.start, end=w.end, initial_equity=base.initial_equity,
                             risk=base.risk, benchmark=base.benchmark)
        res = run_backtest(memo, cfg, strat)
        d = summarize(res)
        (out_dir / f"{w.name}_{strat.name}.html").write_text(
            render_html(res, d, title=f"{strat.label} vs SPY ({w.name})", source=source), encoding="utf-8")
        scores.append(Score(strat.name, strat.label, w.name, d.strategy, trade_stats(res.trades)["trades"]))
        spy_perf = d.benchmark
        print(f"{w.name}: {strat.label} done", file=sys.stderr)
    assert spy_perf is not None
    px = memo.prices([base.benchmark], "2000-01-01", w.end)
    bench_px = px.set_index("date")["close"].sort_index()
    trend = spy_trend_equity(bench_px, w.start, w.end, initial=base.initial_equity)
    scores.append(Score("spy_trend", "SPY 200-day trend", w.name, performance(trend), float("nan")))
    return scores, spy_perf


def tournament(provider: DataProvider, out_dir: Path, source: Source,
               selection: Window, holdout: Window,
               base: BacktestConfig | None = None) -> dict[str, object]:
    base = base or BacktestConfig()
    out_dir.mkdir(parents=True, exist_ok=True)
    memo = MemoProvider(provider)
    # Prime one price download covering every strategy and both windows
    fund = memo.fundamentals()
    tickers = sorted({t for s in library() for t in s.candidates(fund)} | {base.benchmark})
    warm = max(s.warmup_days for s in library()) + 260
    prime_start = (pd.Timestamp(selection.start) - pd.tseries.offsets.BDay(warm)).strftime("%Y-%m-%d")
    memo.prices(tickers, prime_start, holdout.end)

    sel_scores, sel_spy = run_window(memo, selection, out_dir, source, base)
    hold_scores, hold_spy = run_window(memo, holdout, out_dir, source, base)
    winner = pick_winner(sel_scores, sel_spy)
    hold_by = {s.strategy: s for s in hold_scores}
    if winner == "spy":
        confirmed, verdict = True, "No strategy beat SPY on the selection years. Adopt: buy and hold SPY."
    else:
        w = hold_by[winner]
        confirmed = w.perf.sharpe >= hold_spy.sharpe
        verdict = (f"Winner '{w.label}' {'held up' if confirmed else 'did NOT hold up'} on the holdout "
                   f"(Sharpe {w.perf.sharpe:.2f} vs SPY {hold_spy.sharpe:.2f}). "
                   + ("Adopt it." if confirmed else "Its edge looks like luck. Adopt: buy and hold SPY."))
    adopted = winner if (winner != "spy" and confirmed) else "spy"

    result: dict[str, object] = {
        "selection": {"window": selection.__dict__, "spy": sel_spy.as_dict(),
                      "scores": [{"strategy": s.strategy, "label": s.label, **s.perf.as_dict(),
                                  "trades": s.trades} for s in sel_scores]},
        "holdout": {"window": holdout.__dict__, "spy": hold_spy.as_dict(),
                    "scores": [{"strategy": s.strategy, "label": s.label, **s.perf.as_dict(),
                                "trades": s.trades} for s in hold_scores]},
        "winner_on_selection": winner, "confirmed_on_holdout": confirmed,
        "adopted": adopted, "verdict": verdict,
    }
    (out_dir / "tournament.json").write_text(json.dumps(result, indent=2, default=str))
    (out_dir / "tournament.md").write_text(_markdown(sel_scores, sel_spy, hold_scores, hold_spy,
                                                     selection, holdout, winner, verdict))
    return result


def _markdown(sel: list[Score], sel_spy: Performance, hold: list[Score], hold_spy: Performance,
              sw: Window, hw: Window, winner: str, verdict: str) -> str:
    def pct(v: float) -> str:
        return "n/a" if v != v else f"{v:.1%}"

    def table(scores: list[Score], spy: Performance, mark: str) -> str:
        out = "| Strategy | CAGR | Sharpe | Max drawdown | Beats SPY rule |\n|---|---|---|---|---|\n"
        for s in sorted(scores, key=lambda x: -x.perf.sharpe):
            star = " ⭐" if s.strategy == mark else ""
            ok = "yes" if eligible(s.perf, spy) else "no"
            out += f"| {s.label}{star} | {pct(s.perf.cagr)} | {s.perf.sharpe:.2f} | {pct(s.perf.max_drawdown)} | {ok} |\n"
        out += f"| **SPY buy & hold** | {pct(spy.cagr)} | {spy.sharpe:.2f} | {pct(spy.max_drawdown)} | |\n"
        return out

    return (
        "## Strategy tournament\n\n"
        f"**Verdict:** {verdict}\n\n"
        f"### Selection years {sw.start} to {sw.end} (winner chosen here)\n\n"
        + table(sel, sel_spy, winner)
        + f"\n### Holdout years {hw.start} to {hw.end} (never seen during selection)\n\n"
        + table(hold, hold_spy, winner)
        + "\nRule: eligible = Sharpe above SPY and max drawdown within 10 points of SPY's; "
          "winner = highest eligible Sharpe; confirmed only if it also beats SPY's Sharpe on the holdout.\n"
    )


def main(argv: list[str] | None = None) -> int:
    from quantflow.cli import FREE_EARLIEST_START, _load_dotenv

    p = argparse.ArgumentParser(prog="quantflow-tournament")
    p.add_argument("--source", choices=SOURCES, default="free")
    p.add_argument("--selection-start", default=FREE_EARLIEST_START)
    p.add_argument("--selection-end", default="2022-12-30")
    p.add_argument("--holdout-start", default="2023-01-03")
    p.add_argument("--holdout-end", default=BacktestConfig.end)
    p.add_argument("--out-dir", default="reports/tournament")
    args = p.parse_args(argv)
    source: Source = args.source
    if source != "synthetic":
        _load_dotenv()
    try:
        provider = make_provider(source)
    except ProviderConfigError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    out = Path(args.out_dir)
    tournament(provider, out, source,
               Window("selection", args.selection_start, args.selection_end),
               Window("holdout", args.holdout_start, args.holdout_end))
    print((out / "tournament.md").read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
