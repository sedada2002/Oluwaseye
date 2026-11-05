import numpy as np
import pandas as pd

from quantflow.indicators import atr, rma


def test_rma_seeds_with_sma_then_wilder() -> None:
    vals = np.array([np.nan, 1.0, 2.0, 3.0, 4.0, 5.0])
    out = rma(vals, 3)
    assert np.isnan(out[:3]).all()
    assert out[3] == 2.0                                  # SMA of 1,2,3
    assert np.isclose(out[4], (4.0 + 2 * 2.0) / 3)        # alpha = 1/3
    assert np.isclose(out[5], (5.0 + 2 * out[4]) / 3)


def test_atr_matches_hand_calculation() -> None:
    idx = pd.bdate_range("2024-01-01", periods=5)
    high = pd.Series([11, 12, 13, 12, 15], index=idx, dtype=float)
    low = pd.Series([9, 10, 11, 9, 12], index=idx, dtype=float)
    close = pd.Series([10, 11, 12, 10, 14], index=idx, dtype=float)
    # TR: 2 (h-l, no prev), max(2,2,1)=2, max(2,2,0)=2, max(3,0,3)=3, max(3,5,2)=5
    a = atr(high, low, close, 3)
    assert np.isclose(a.iloc[2], 2.0)
    assert np.isclose(a.iloc[3], (3 + 2 * 2.0) / 3)
    assert np.isclose(a.iloc[4], (5 + 2 * a.iloc[3]) / 3)
