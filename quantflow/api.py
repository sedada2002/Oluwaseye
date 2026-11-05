"""FastAPI relay. The Sharadar key stays server-side; the browser only sees results.

    uvicorn quantflow.api:app --port 8000

Backtests are slow (minutes on full history), so production should queue them
(background task + job id). This synchronous route is fine for a single user.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from quantflow.config import BacktestConfig, RiskConfig, ScreenConfig
from quantflow.data.base import DataProvider
from quantflow.data.factory import ProviderConfigError, Source, make_provider
from quantflow.engine import run_backtest
from quantflow.report import render_html, summarize

app = FastAPI(title="QuantFlow backtest relay")


class BacktestRequest(BaseModel):
    start: str = "2012-01-01"
    end: str = "2026-10-31"
    initial_equity: float = Field(100_000.0, gt=0)
    max_positions: int = Field(20, ge=1, le=100)
    atr_multiplier: float = Field(3.0, gt=0)
    rs_lookback_days: int = Field(126, ge=20, le=504)
    exit_on_screen_fail: bool = False
    source: Source = "free"


def _provider(source: Source) -> DataProvider:
    try:
        return make_provider(source)
    except ProviderConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


def _config(req: BacktestRequest) -> BacktestConfig:
    return BacktestConfig(
        start=req.start, end=req.end, initial_equity=req.initial_equity,
        exit_on_screen_fail=req.exit_on_screen_fail,
        screen=replace(ScreenConfig(), rs_lookback_days=req.rs_lookback_days),
        risk=replace(RiskConfig(), max_positions=req.max_positions, atr_multiplier=req.atr_multiplier),
    )


def _series_json(s: "pd.Series") -> dict[str, float]:
    return {ts.strftime("%Y-%m-%d"): float(v) for ts, v in zip(pd.DatetimeIndex(s.index), s.to_numpy())}


@app.post("/backtest")
def backtest(req: BacktestRequest) -> dict[str, Any]:
    result = run_backtest(_provider(req.source), _config(req))
    d = summarize(result)
    return {
        "source": req.source,
        "strategy": d.strategy.as_dict(),
        "benchmark": d.benchmark.as_dict(),
        "relative": d.relative,
        "trades": d.trades,
        "sectors": d.sectors,
        "verdict": d.verdict,
        "notes": result.notes,
        "equity": _series_json(result.equity),
        "benchmark_equity": _series_json(result.benchmark),
    }


@app.post("/backtest/report", response_class=HTMLResponse)
def backtest_report(req: BacktestRequest) -> str:
    result = run_backtest(_provider(req.source), _config(req))
    return render_html(result, source=req.source)
