"""Self-contained HTML report: strategy vs SPY. No external scripts, works offline."""

from __future__ import annotations

import html
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from quantflow.data.factory import Source, source_line
from quantflow.engine import BacktestResult
from quantflow.metrics import (
    Performance,
    drawdown,
    performance,
    relative,
    sector_concentration,
    trade_stats,
)


@dataclass
class ReportData:
    strategy: Performance
    benchmark: Performance
    relative: dict[str, float]
    trades: dict[str, float]
    sectors: dict[str, float | str]
    sector_avg: pd.Series
    verdict: list[str]


def summarize(result: BacktestResult) -> ReportData:
    rf = result.config.risk_free_rate
    s = performance(result.equity, rf)
    b = performance(result.benchmark, rf)
    shares, sec = sector_concentration(result.holdings)
    sector_avg = shares.mean().sort_values(ascending=False) if not shares.empty else pd.Series(dtype=float)
    verdict: list[str] = []
    verdict.append(
        f"Sharpe {s.sharpe:.2f} vs {b.sharpe:.2f} for {result.config.benchmark}: "
        + ("the strategy earned more per unit of risk." if s.sharpe > b.sharpe
           else "the strategy did NOT beat the index on a risk-adjusted basis.")
    )
    verdict.append(
        f"Max drawdown {s.max_drawdown:.1%} vs {b.max_drawdown:.1%}: "
        + ("shallower than the index." if s.max_drawdown > b.max_drawdown else "deeper than the index.")
    )
    top = sec.get("avg_top_sector_share", float("nan"))
    if isinstance(top, float) and not math.isnan(top) and top > 0.5:
        verdict.append(
            f"On average {top:.0%} of invested capital sat in one sector "
            f"({sec.get('most_common_top_sector')}). This is a sector bet as much as a factor screen."
        )
    return ReportData(s, b, relative(result.equity, result.benchmark),
                      trade_stats(result.trades), sec, sector_avg, verdict)


# ---- tiny SVG chart helpers ---------------------------------------------------------

def _line_chart(series: dict[str, pd.Series], height: int = 260, pct: bool = False, log: bool = False) -> str:
    w, h, pad_l, pad_b, pad_t = 900, height, 64, 28, 12
    all_vals = pd.concat(list(series.values())).dropna()
    vals = np.log(all_vals) if log else all_vals
    lo, hi = float(vals.min()), float(vals.max())
    if hi == lo:
        hi = lo + 1
    idx = next(iter(series.values())).index
    t0, t1 = idx[0].value, idx[-1].value

    def x(ts: pd.Timestamp) -> float:
        return float(pad_l + (ts.value - t0) / (t1 - t0) * (w - pad_l - 8))

    def y(v: float) -> float:
        vv = math.log(v) if log else v
        return pad_t + (hi - vv) / (hi - lo) * (h - pad_t - pad_b)

    parts = [f'<svg viewBox="0 0 {w} {h}" role="img" class="chart">']
    for i in range(5):
        level_t = lo + (hi - lo) * i / 4
        level = math.exp(level_t) if log else level_t
        yy = y(level)
        label = f"{level:.0%}" if pct else f"{level:,.0f}"
        parts.append(f'<line x1="{pad_l}" x2="{w-8}" y1="{yy:.1f}" y2="{yy:.1f}" class="grid"/>')
        parts.append(f'<text x="{pad_l-8}" y="{yy+4:.1f}" class="axis" text-anchor="end">{label}</text>')
    years = pd.date_range(idx[0], idx[-1], freq="YS")
    step = max(1, len(years) // 8)
    for ts in years[::step]:
        parts.append(f'<text x="{x(ts):.1f}" y="{h-8}" class="axis" text-anchor="middle">{ts.year}</text>')
    for k, (name, s) in enumerate(series.items()):
        s = s.dropna()
        stride = max(1, len(s) // 600)
        thin = s.iloc[::stride]
        pts = " ".join(f"{x(ts):.1f},{y(float(v)):.1f}"
                       for ts, v in zip(pd.DatetimeIndex(thin.index), thin.to_numpy()))
        parts.append(f'<polyline points="{pts}" class="s{k}" fill="none"/>')
    parts.append("</svg>")
    legend = "".join(
        f'<span class="key"><i class="k{k}"></i>{html.escape(n)}</span>' for k, n in enumerate(series)
    )
    return f'<div class="legend">{legend}</div>' + "".join(parts)


def _bars(values: pd.Series) -> str:
    rows = []
    for name, v in values.items():
        rows.append(
            f'<div class="bar"><span>{html.escape(str(name))}</span>'
            f'<div class="track"><div class="fill" style="width:{v*100:.1f}%"></div></div>'
            f'<b>{v:.0%}</b></div>'
        )
    return "".join(rows)


def _fmt(v: Any, kind: str) -> str:
    if isinstance(v, float) and math.isnan(v):
        return "–"
    if kind == "pct":
        return f"{v:.1%}"
    if kind == "num":
        return f"{v:.2f}"
    if kind == "int":
        return f"{int(v):,}"
    return html.escape(str(v))


def render_html(
    result: BacktestResult,
    data: ReportData | None = None,
    title: str = "QuantFlow vs SPY",
    source: "Source" = "sharadar",
) -> str:
    d = data or summarize(result)
    s, b = d.strategy, d.benchmark
    cfg = result.config
    bench = cfg.benchmark
    rows = [
        ("CAGR", s.cagr, b.cagr, "pct"),
        ("Total return", s.total_return, b.total_return, "pct"),
        ("Sharpe", s.sharpe, b.sharpe, "num"),
        ("Sortino", s.sortino, b.sortino, "num"),
        ("Volatility", s.volatility, b.volatility, "pct"),
        ("Max drawdown", s.max_drawdown, b.max_drawdown, "pct"),
        ("Longest underwater (days)", s.max_drawdown_days, b.max_drawdown_days, "int"),
        ("Calmar", s.calmar, b.calmar, "num"),
    ]
    perf_table = "".join(
        f"<tr><td>{n}</td><td>{_fmt(a, k)}</td><td>{_fmt(c, k)}</td></tr>" for n, a, c, k in rows
    )
    t = d.trades
    trade_table = "".join(
        f"<tr><td>{n}</td><td>{_fmt(t.get(key, float('nan')), k)}</td></tr>"
        for n, key, k in [
            ("Trades", "trades", "int"), ("Win rate", "win_rate", "pct"),
            ("Avg winner", "avg_win", "pct"), ("Avg loser", "avg_loss", "pct"),
            ("Profit factor", "profit_factor", "num"), ("Avg hold (days)", "avg_hold_days", "int"),
            ("Hit +20% partial", "partial_hit_rate", "pct"),
        ]
    )
    rel = d.relative
    rel_table = "".join(
        f"<tr><td>{n}</td><td>{_fmt(rel[key], k)}</td></tr>"
        for n, key, k in [("Beta", "beta", "num"), ("Alpha (annual)", "alpha_annual", "pct"),
                          ("Tracking error", "tracking_error", "pct"),
                          ("Information ratio", "information_ratio", "num")]
    )
    sec = d.sectors
    sec_table = "".join(
        f"<tr><td>{n}</td><td>{_fmt(sec.get(key, float('nan')), k)}</td></tr>"
        for n, key, k in [("Avg positions held", "avg_positions", "num"),
                          ("Top sector, % of invested", "avg_top_sector_share", "pct"),
                          ("Worst month top-sector share", "max_top_sector_share", "pct"),
                          ("Avg HHI (1.0 = one sector)", "avg_hhi", "num"),
                          ("Most frequent top sector", "most_common_top_sector", "str")]
    )
    eq_chart = _line_chart({"Strategy": result.equity, bench: result.benchmark}, log=True)
    dd_chart = _line_chart({"Strategy": drawdown(result.equity), bench: drawdown(result.benchmark)},
                           height=200, pct=True)
    footer = source_line(source)
    if source == "synthetic":
        title = f"[SYNTHETIC] {title}"
    elif source == "free":
        title = f"{title} (free data)"
    verdict = "".join(f"<li>{html.escape(v)}</li>" for v in d.verdict)
    notes = "".join(f"<li>{html.escape(n)}</li>" for n in result.notes)
    rc, sc = cfg.risk, cfg.screen
    params = (
        f"Screen: revenue CAGR &gt; {sc.min_revenue_cagr:.0%} over {sc.cagr_years}y (as-reported TTM, "
        f"point-in-time), D/E &lt; {sc.max_debt_to_equity}, {sc.rs_lookback_days}-day return above {bench}. "
        f"Risk: {rc.risk_per_trade:.0%} equity risk per trade, {rc.atr_multiplier}× ATR({rc.atr_period}) "
        f"initial and trailing stop, {rc.partial_fraction:.0%} out at +{rc.partial_target:.0%} then stop to "
        f"break-even, max {rc.max_positions} positions, {rc.slippage_bps:g} bps slippage. "
        f"Monthly screen, entries at next open. {cfg.start} to {cfg.end}."
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<style>
:root{{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--line:#e4e1d9;--card:#ffffff;
--a:#1f6feb;--b:#b4602a;--fill:#1f6feb;}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#151513;--fg:#ecebe6;
--muted:#9a988f;--line:#2e2d29;--card:#1d1c1a;--a:#6ea8ff;--b:#e39a62;--fill:#6ea8ff;}}}}
:root[data-theme="dark"]{{--bg:#151513;--fg:#ecebe6;--muted:#9a988f;--line:#2e2d29;--card:#1d1c1a;
--a:#6ea8ff;--b:#e39a62;--fill:#6ea8ff;}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}}
main{{max-width:980px;margin:0 auto;padding:32px 16px 64px}}
h1{{font-size:26px;margin:0 0 4px}} h2{{font-size:17px;margin:32px 0 10px}}
.sub{{color:var(--muted);margin:0 0 20px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:12px 0}}
.verdict li{{margin:4px 0}}
.grid3{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}}
table{{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}}
td,th{{padding:6px 4px;border-bottom:1px solid var(--line);text-align:right}}
td:first-child,th:first-child{{text-align:left;color:var(--muted)}}
.chart{{width:100%;height:auto;display:block}}
.chart .grid{{stroke:var(--line)}} .chart .axis{{fill:var(--muted);font-size:11px}}
.chart .s0{{stroke:var(--a);stroke-width:1.8}} .chart .s1{{stroke:var(--b);stroke-width:1.5}}
.legend{{display:flex;gap:16px;font-size:13px;color:var(--muted);margin-bottom:6px}}
.key i{{display:inline-block;width:14px;height:3px;margin-right:6px;vertical-align:middle}}
.k0{{background:var(--a)}} .k1{{background:var(--b)}}
.bar{{display:grid;grid-template-columns:150px 1fr 44px;gap:8px;align-items:center;margin:5px 0;font-size:13px}}
.track{{background:var(--line);border-radius:3px;height:10px}} .fill{{background:var(--fill);height:10px;border-radius:3px}}
.bar b{{text-align:right;font-weight:500}}
.foot{{color:var(--muted);font-size:13px}} a{{color:var(--a)}}
@media (max-width:520px){{.bar{{grid-template-columns:100px 1fr 40px}}}}
</style></head><body><main>
<h1>{html.escape(title)}</h1>
<p class="sub">{params}</p>
<div class="card verdict"><b>Bottom line</b><ul>{verdict}</ul></div>
<h2>Equity (log scale)</h2><div class="card">{eq_chart}</div>
<h2>Drawdown</h2><div class="card">{dd_chart}</div>
<h2>Performance</h2>
<div class="card"><table><tr><th></th><th>Strategy</th><th>{bench}</th></tr>{perf_table}</table></div>
<div class="grid3">
<div class="card"><b>Trades</b><table>{trade_table}</table></div>
<div class="card"><b>Vs {bench}</b><table>{rel_table}</table></div>
<div class="card"><b>Concentration</b><table>{sec_table}</table></div>
</div>
<h2>Average sector share of invested capital</h2>
<div class="card">{_bars(d.sector_avg) if not d.sector_avg.empty else "No holdings."}</div>
<h2>Caveats</h2><div class="card foot"><ul>{notes}</ul></div>
<p class="foot">{footer} Backtested results are hypothetical and not investment advice.</p>
</main></body></html>"""
