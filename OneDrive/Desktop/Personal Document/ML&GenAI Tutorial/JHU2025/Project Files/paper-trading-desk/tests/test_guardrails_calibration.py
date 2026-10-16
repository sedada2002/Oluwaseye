import pytest

from paper_desk.broker import PaperBroker
from paper_desk.calibration import brier, expected_calibration_error, reliability
from paper_desk.config import Costs, Risk
from paper_desk.guardrails import Guardrails


def test_kill_file_blocks_open(tmp_path):
    kill = tmp_path / "KILL"
    b = PaperBroker(Costs(), Risk(), cash=1000)
    g = Guardrails(Risk(), str(kill), start_equity=1000)
    assert g.check_open(b, 50) == (True, None)
    kill.write_text("stop")
    assert g.check_open(b, 50) == (False, "kill_switch")


def test_session_loss_limit_blocks_open():
    b = PaperBroker(Costs(), Risk(session_loss_limit_usd=100), cash=800)
    g = Guardrails(Risk(session_loss_limit_usd=100), None, start_equity=1000)
    assert g.check_open(b, 50) == (False, "session_loss_limit")


def test_position_open_blocks_second_open():
    b = PaperBroker(Costs(slippage_per_liquidity=0), Risk(), cash=1000)
    b.open("t1", "A", "solana", 1.0, 100_000, 50, 0)
    g = Guardrails(Risk(), None, start_equity=1000)
    assert g.check_open(b, 50) == (False, "position_open")


def test_brier_and_bounds():
    assert brier([(1.0, 1), (0.0, 0)]) == 0.0
    assert brier([(0.5, 1), (0.5, 0)]) == pytest.approx(0.25)
    with pytest.raises(ValueError):
        brier([(1.5, 1)])
    with pytest.raises(ValueError):
        brier([(0.5, 2)])


def test_reliability_bins_and_ece():
    pairs = [(0.85, 1)] * 8 + [(0.85, 0)] * 2   # predicted 0.85, observed 0.80
    rel = reliability(pairs)
    filled = [b for b in rel if b["n"]]
    assert len(filled) == 1
    assert filled[0]["hit_rate"] == pytest.approx(0.8)
    assert expected_calibration_error(pairs) == pytest.approx(0.05)
