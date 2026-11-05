"""Indicators that match TradingView Pine Script v5 definitions."""

from __future__ import annotations

import numpy as np
import pandas as pd


def rma(values: np.ndarray, length: int) -> np.ndarray:
    """Pine ta.rma: seeded with the SMA of the first `length` valid values, then
    Wilder smoothing with alpha = 1/length. NaNs before the first valid value stay NaN;
    a NaN after seeding (a missing bar) carries the previous value forward."""
    out = np.full(len(values), np.nan)
    valid = np.flatnonzero(~np.isnan(values))
    if len(valid) < length:
        return out
    first = valid[length - 1]
    seed_vals = values[valid[:length]]
    out[first] = seed_vals.mean()
    alpha = 1.0 / length
    prev = out[first]
    for i in range(first + 1, len(values)):
        v = values[i]
        if not np.isnan(v):
            prev = alpha * v + (1 - alpha) * prev
        out[i] = prev
    return out


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1, skipna=False)
    # Pine: on the first bar there is no previous close, so TR = high - low
    return tr.where(prev_close.notna(), high - low)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    """Pine ta.atr(length) = ta.rma(ta.tr(true), length)."""
    tr = true_range(high, low, close)
    return pd.Series(rma(tr.to_numpy(dtype=float), length), index=close.index)


def atr_wide(
    high: pd.DataFrame, low: pd.DataFrame, close: pd.DataFrame, length: int = 14
) -> pd.DataFrame:
    """ATR per column of date x ticker frames. Each ticker is computed on its own
    trading days only, so gaps after delisting don't distort the seed."""
    out = pd.DataFrame(np.nan, index=close.index, columns=close.columns)
    for col in close.columns:
        mask = close[col].notna()
        if mask.sum() < length:
            continue
        out.loc[mask, col] = atr(high.loc[mask, col], low.loc[mask, col], close.loc[mask, col], length).to_numpy()
    return out
