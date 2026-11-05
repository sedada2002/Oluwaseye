from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pandas as pd
import pytest

from quantflow.broker import Account, Holding, load_positions_file, lots_from_fills
from quantflow.config import RiskConfig
from quantflow.data.fixtures import SyntheticProvider
from quantflow.engine import run_backtest
from quantflow.signals import generate, is_rebalance_day, stop_state, to_markdown
from tests.test_engine import CFG, _path, _provider

RISK = replace(RiskConfig(), slippage_bps=0.0)


def _bars(p, upto: pd.Timestamp) -> pd.DataFrame:  # type: ignore[no-untyped-def]
    px = p.prices(["GRO"], "2000-01-01", "2030-01-01").set_index("date")
    return px.loc[px.index <= upto, ["high", "low", "close"]]


def test_signal_stop_matches_engine_exit() -> None:
    """Replay the engine's trade: the day the engine stopped out, signals must say SELL_ALL
    at the same stop; the day before, HOLD."""
    p = _provider(_path(pd.Timestamp("2022-09-30"), up=0.004, down=0.05))
    trade = run_backtest(p, CFG).trades.iloc[0]
    assert trade["exit_reason"] == "stop"
    entry, exit_day = pd.Timestamp(trade["entry_date"]), pd.Timestamp(trade["exit_date"])
    h = Holding("GRO", int(trade["shares"]) // 2 + int(trade["shares"]) % 2, entry,
                float(trade["entry_price"]), int(trade["shares"]))       # half already sold
    st = stop_state(_bars(p, exit_day), h, RISK)
    assert st.action == "SELL_ALL"
    assert st.prev_stop == pytest.approx(trade["exit_price"], rel=1e-9)
    day_before = _bars(p, exit_day).index[-2]
    assert stop_state(_bars(p, day_before), h, RISK).action != "SELL_ALL"


def test_sell_half_when_target_hit_and_not_yet_taken() -> None:
    p = _provider(_path(pd.Timestamp("2022-09-30"), up=0.004, down=0.05))
    trade = run_backtest(p, CFG).trades.iloc[0]
    entry = pd.Timestamp(trade["entry_date"])
    h = Holding("GRO", int(trade["shares"]), entry, float(trade["entry_price"]), int(trade["shares"]))
    bars = _bars(p, pd.Timestamp("2022-07-15"))
    st = stop_state(bars, h, RISK)
    assert st.target_hit and st.action == "SELL_HALF"
    assert st.qty_to_sell == int(trade["shares"]) // 2
    assert st.stop >= h.entry_price                       # break-even once the target is hit


def test_stop_never_moves_down() -> None:
    p = _provider(_path(pd.Timestamp("2022-06-30"), up=0.004, down=0.01))
    trade = run_backtest(p, CFG).trades.iloc[0]
    h = Holding("GRO", 10, pd.Timestamp(trade["entry_date"]), float(trade["entry_price"]), 20)
    days = _bars(p, pd.Timestamp("2022-12-30")).index
    stops = [stop_state(_bars(p, d), h, RISK).stop for d in days[days > h.entry_date][:120]]
    assert all(b >= a - 1e-9 for a, b in zip(stops, stops[1:]))


def test_lots_from_fills_tracks_current_lot() -> None:
    fills = [
        {"symbol": "AAA", "side": "buy", "qty": "10", "transaction_time": "2026-01-05T15:00:00Z"},
        {"symbol": "AAA", "side": "sell", "qty": "10", "transaction_time": "2026-02-05T15:00:00Z"},
        {"symbol": "AAA", "side": "buy", "qty": "30", "transaction_time": "2026-03-02T15:00:00Z"},
        {"symbol": "AAA", "side": "sell", "qty": "15", "transaction_time": "2026-04-10T15:00:00Z"},
        {"symbol": "BRK.B", "side": "buy", "qty": "5", "transaction_time": "2026-03-31T15:00:00Z"},
    ]
    lots = lots_from_fills(fills)
    assert lots["AAA"] == (pd.Timestamp("2026-03-02"), 30)    # new lot after flat; half sold
    assert lots["BRK-B"] == (pd.Timestamp("2026-03-31"), 5)


def test_rebalance_day_detection() -> None:
    assert is_rebalance_day(pd.Timestamp("2026-10-30"))       # Fri, last weekday of Oct
    assert not is_rebalance_day(pd.Timestamp("2026-10-29"))
    assert is_rebalance_day(pd.Timestamp("2026-12-31"))


def _account(tmp_path: Path, holdings: list[dict[str, object]]) -> Account:
    f = tmp_path / "positions.json"
    f.write_text(json.dumps({"equity": 100_000, "cash": 60_000, "holdings": holdings}))
    return load_positions_file(f, None, None)


def test_generate_rebalance_buys_respect_risk_limits(tmp_path: Path) -> None:
    sp = SyntheticProvider()
    acct = _account(tmp_path, [])
    sig = generate(sp, "momentum", acct, asof="2024-05-31", rebalance="yes")
    buys = [a for a in sig["actions"] if a["action"] == "BUY"]  # type: ignore[union-attr,index]
    assert buys, "synthetic data should produce momentum picks"
    total = sum(float(b["qty"]) * float(b["price"]) for b in buys)  # type: ignore[index]
    assert total <= 60_000 + 1e-6                                   # within cash
    for b in buys:
        notional = float(b["qty"]) * float(b["price"])  # type: ignore[index]
        risk = float(b["qty"]) * (float(b["price"]) - float(b["stop"]))  # type: ignore[index]
        assert notional <= 10_000 + 1e-6 and risk <= 1_000 + 1e-6
    assert "BUY" in to_markdown(sig)


def test_generate_non_rebalance_day_manages_holdings_only(tmp_path: Path) -> None:
    sp = SyntheticProvider()
    acct = _account(tmp_path, [{"ticker": "T003", "qty": 50, "entry_date": "2024-01-02",
                                "entry_price": 40.0, "initial_qty": 50}])
    sig = generate(sp, "momentum", acct, asof="2024-05-15", rebalance="auto")
    assert sig["rebalance_day"] is False
    assert not [a for a in sig["actions"] if a["action"] == "BUY"]  # type: ignore[union-attr,index]
    assert [h["ticker"] for h in sig["holdings"]] == ["T003"]  # type: ignore[union-attr,index]
    md = to_markdown(sig)
    assert "Holdings and stops" in md and "no orders were placed" in md


def test_spy_trend_signal(tmp_path: Path) -> None:
    sig = generate(SyntheticProvider(), "spy_trend", _account(tmp_path, []), asof="2024-05-15")
    a = sig["actions"][0]  # type: ignore[index]
    assert a["ticker"] == "SPY" and a["action"] in ("BUY", "HOLD")
