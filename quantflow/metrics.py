"""Performance metrics, computed the same way for strategy and benchmark."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

TRADING_DAYS = 252


@dataclass(frozen=True)
class Performance:
    total_return: float
    cagr: float
    volatility: float
    sharpe: float
    sortino: float
    max_drawdown: float
    max_drawdown_days: int
    calmar: float

    def as_dict(self) -> dict[str, float]:
        return {k: float(v) for k, v in asdict(self).items()}


def drawdown(equity: pd.Series) -> pd.Series:
    return equity / equity.cummax() - 1.0


def performance(equity: pd.Series, risk_free: float = 0.0) -> Performance:
    equity = equity.dropna()
    rets = equity.pct_change().dropna()
    years = (equity.index[-1] - equity.index[0]).days / 365.25
    total = float(equity.iloc[-1] / equity.iloc[0] - 1.0)
    cagr = (1 + total) ** (1 / years) - 1 if years > 0 and total > -1 else float("nan")
    rf_daily = (1 + risk_free) ** (1 / TRADING_DAYS) - 1
    excess = rets - rf_daily
    vol = float(rets.std(ddof=1) * np.sqrt(TRADING_DAYS))
    sd = excess.std(ddof=1)
    sharpe = float(excess.mean() / sd * np.sqrt(TRADING_DAYS)) if sd > 0 else float("nan")
    downside = excess[excess < 0]
    dd_sd = np.sqrt((downside**2).mean()) if len(downside) else 0.0
    sortino = float(excess.mean() / dd_sd * np.sqrt(TRADING_DAYS)) if dd_sd > 0 else float("nan")

    dd = drawdown(equity)
    mdd = float(dd.min())
    # longest stretch below a prior high, in calendar days
    underwater = dd < 0
    longest = 0
    start: pd.Timestamp | None = None
    for ts, uw in zip(pd.DatetimeIndex(underwater.index), underwater.to_numpy()):
        if uw and start is None:
            start = ts
        elif not uw and start is not None:
            longest = max(longest, (ts - start).days)
            start = None
    if start is not None:
        longest = max(longest, (equity.index[-1] - start).days)
    calmar = cagr / abs(mdd) if mdd < 0 else float("nan")
    return Performance(total, cagr, vol, sharpe, sortino, mdd, longest, calmar)


def trade_stats(trades: pd.DataFrame) -> dict[str, float]:
    if trades.empty:
        return {"trades": 0, "win_rate": float("nan"), "avg_win": float("nan"),
                "avg_loss": float("nan"), "profit_factor": float("nan"),
                "avg_hold_days": float("nan"), "partial_hit_rate": float("nan")}
    wins = trades[trades["pnl"] > 0]
    losses = trades[trades["pnl"] <= 0]
    gross_loss = -losses["pnl"].sum()
    hold = (pd.to_datetime(trades["exit_date"]) - pd.to_datetime(trades["entry_date"])).dt.days
    return {
        "trades": float(len(trades)),
        "win_rate": float(len(wins) / len(trades)),
        "avg_win": float(wins["return"].mean()) if len(wins) else float("nan"),
        "avg_loss": float(losses["return"].mean()) if len(losses) else float("nan"),
        "profit_factor": float(wins["pnl"].sum() / gross_loss) if gross_loss > 0 else float("nan"),
        "avg_hold_days": float(hold.mean()),
        "partial_hit_rate": float(trades["partial_taken"].mean()),
    }


def sector_concentration(holdings: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, float | str]]:
    """Per-snapshot sector weights (as a share of invested capital) plus summary stats.
    HHI: 1/n for perfectly spread across n sectors, 1.0 for a single sector."""
    if holdings.empty:
        return pd.DataFrame(), {"avg_top_sector_share": float("nan"),
                                "max_top_sector_share": float("nan"), "avg_hhi": float("nan"),
                                "avg_positions": 0.0, "most_common_top_sector": "n/a"}
    by = holdings.groupby(["date", "sector"])["value"].sum().unstack(fill_value=0)
    shares = by.div(by.sum(axis=1), axis=0)
    top = shares.max(axis=1)
    hhi = (shares**2).sum(axis=1)
    counts = holdings.groupby("date")["ticker"].count()
    return shares, {
        "avg_top_sector_share": float(top.mean()),
        "max_top_sector_share": float(top.max()),
        "avg_hhi": float(hhi.mean()),
        "avg_positions": float(counts.mean()),
        "most_common_top_sector": str(shares.idxmax(axis=1).mode().iloc[0]),
    }


def relative(equity: pd.Series, bench: pd.Series) -> dict[str, float]:
    """Beta, annualized alpha, tracking error, information ratio vs benchmark."""
    r = equity.pct_change().dropna()
    b = bench.reindex(r.index).pct_change().dropna()
    r = r.reindex(b.index)
    var_b = b.var(ddof=1)
    beta = float(r.cov(b) / var_b) if var_b > 0 else float("nan")
    active = r - b
    te = float(active.std(ddof=1) * np.sqrt(TRADING_DAYS))
    alpha = float((r.mean() - beta * b.mean()) * TRADING_DAYS)
    ir = float(active.mean() * TRADING_DAYS / te) if te > 0 else float("nan")
    return {"beta": beta, "alpha_annual": alpha, "tracking_error": te, "information_ratio": ir}
