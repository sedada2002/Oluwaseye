import pytest

from paper_desk.broker import PaperBroker
from paper_desk.config import Costs, Risk

NO_SLIP = Costs(slippage_per_liquidity=0.0)


def make(cash=1000.0, **risk):
    return PaperBroker(NO_SLIP, Risk(**risk), cash=cash)


def test_round_trip_flat_price_loses_only_fees():
    b = make()
    b.open("t1", "TKN", "solana", price=2.0, liquidity_usd=100_000, ticket_usd=100, t=0)
    trade = b.close(5, "time_stop")
    # entry fee and exit fee both at the 0.95 floor (0.45% of $100 is below it)
    assert trade["pnl_usd"] == pytest.approx(-1.90, abs=0.01)
    assert b.equity() == pytest.approx(1000 - 1.90, abs=0.01)


def test_cannot_open_twice_or_over_cash():
    b = make(cash=50)
    with pytest.raises(ValueError):
        b.open("t1", "TKN", "solana", 1.0, 100_000, 100, 0)  # ticket over cash
    b = make()
    b.open("t1", "TKN", "solana", 1.0, 100_000, 50, 0)
    with pytest.raises(RuntimeError):
        b.open("t2", "TWO", "solana", 1.0, 100_000, 50, 0)


def test_stop_loss_and_take_profit():
    b = make()
    b.open("t1", "TKN", "solana", 1.0, 100_000, 100, 0)
    assert b.mark(1, price=0.6) == "stop_loss"
    b2 = make()
    b2.open("t2", "TKN", "solana", 1.0, 100_000, 100, 0)
    assert b2.mark(1, price=1.6) == "take_profit"


def test_missing_marks_force_exit_after_limit():
    b = make(max_missing_marks=3)
    b.open("t1", "TKN", "solana", 1.0, 100_000, 100, 0)
    assert b.mark(1, price=None) is None
    assert b.mark(2, price=None) is None
    assert b.mark(3, price=None) == "missing_data"


def test_volume_dried_and_time_stop():
    b = make(max_hold_minutes=60)
    b.open("t1", "TKN", "solana", 1.0, 100_000, 100, 0)
    # h6 is 10% of the average six-hour share of h24 -> dried
    assert b.mark(1, price=1.0, volume_h6=1_000, volume_h24=40_000) == "volume_dried"
    b2 = make(max_hold_minutes=60)
    b2.open("t2", "TKN", "solana", 1.0, 100_000, 100, 0)
    assert b2.mark(61, price=1.0) == "time_stop"


def test_slippage_makes_round_trip_worse():
    b = PaperBroker(Costs(slippage_per_liquidity=1.0), Risk(), cash=1000)
    b.open("t1", "TKN", "solana", 1.0, 10_000, 100, 0)  # 1% impact on entry
    assert b.position.entry_price > 1.0
    trade = b.close(1, "time_stop")
    assert trade["pnl_usd"] < -1.90
