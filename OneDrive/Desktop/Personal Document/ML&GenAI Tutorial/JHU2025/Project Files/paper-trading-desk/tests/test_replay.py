import json

from paper_desk.config import Costs, Risk, HardGates
from paper_desk.evaluate import compare, judge_calibration, load_log
from paper_desk.judge import JudgeError
from paper_desk.replay import Desk, run_cycles


def good(tid, ticker, price=1.0, future=None, **over):
    c = {"tid": tid, "ticker": ticker, "chain": "solana", "price_usd": price,
         "age_minutes": 120, "liquidity_usd": 50_000, "volume_h24": 200_000,
         "mcap_usd": 500_000, "trades_h24": 900, "buys_h1": 40, "sells_h1": 25,
         "holder_count": 300, "top_10_percent": 30, "top_wallet_percent": 0.02,
         "mint_authority": None, "freeze_authority": None,
         "future_prices": future or {"60m": price * 1.1}}
    c.update(over)
    return c


CLEAN_ANSWERS = {
    "shape": {"choice": "crowd", "probabilities": {"crowd": 0.9}},
    "concentration_is_exit_risk": {"noul": 0.1},
    "authority_risk": {"choice": "renounced"},
    "account_is_the_project": {"noul": 0.9},
}


class StubJudge:
    """Answers every market/chain question with clean answers and picks the named ticker."""

    def __init__(self, pick_ticker="AAA", worth=0.9, conf=0.8, fail_on=None):
        self.pick_ticker, self.worth, self.conf = pick_ticker, worth, conf
        self.fail_on = fail_on
        self.calls = []

    def ask(self, question_set, state):
        self.calls.append(question_set)
        if question_set == self.fail_on:
            raise JudgeError("boom")
        if question_set == "pick":
            return {"answers": {
                "best": {"choice": self.pick_ticker, "confidence": self.conf,
                         "probabilities": {}},
                "worth_trading_at_all": {"noul": self.worth}}}
        return {"answers": dict(CLEAN_ANSWERS)}


def cycle(t, cands, marks=None):
    return {"t": t, "candidates": cands, "marks": marks or {}}


def test_funnel_only_mode_records_survivors_and_never_trades():
    log = []
    d = Desk(judge=None, log=log.append)
    run_cycles([cycle(0, [good("a", "AAA"), good("b", "BBB", age_minutes=2)])], d)
    events = [r["event"] for r in log]
    assert "survived_hard" in events
    assert any(r.get("reason") == "age" for r in log if r["event"] == "reject")
    assert "open" not in events


def test_judge_picks_and_position_closes_on_take_profit():
    log = []
    d = Desk(judge=StubJudge(pick_ticker="AAA"), log=log.append)
    cands = [good("a", "AAA"), good("b", "BBB", volume_h24=300_000)]
    marks = {"a": {"price": 1.7, "liquidity_usd": 50_000}}
    res = run_cycles([cycle(0, cands), cycle(1, [], marks)], d)
    opens = [r for r in log if r["event"] == "open"]
    closes = [r for r in log if r["event"] == "close"]
    assert len(opens) == 1 and opens[0]["ticker"] == "AAA"
    assert closes and closes[0]["reason"] == "take_profit"
    assert res["trades"][0]["ticker"] == "AAA"


def test_no_scan_while_holding():
    judge = StubJudge(pick_ticker="AAA")
    d = Desk(judge=judge)
    d.step(0, [good("a", "AAA"), good("b", "BBB")], {})
    d.step(1, [good("c", "CCC")], {"a": {"price": 1.0}})
    # cycle 1 only marks the held position, so no new screening calls happen
    assert d.broker.position is not None
    assert judge.calls.count("market") == 2  # both candidates from cycle 0 only


def test_single_survivor_does_not_trade():
    log = []
    d = Desk(judge=StubJudge(), log=log.append)
    run_cycles([cycle(0, [good("a", "AAA")])], d)
    assert any(r.get("reason") == "single_survivor" for r in log)
    assert "open" not in [r["event"] for r in log]


def test_weak_pick_is_not_traded():
    log = []
    d = Desk(judge=StubJudge(worth=0.2), log=log.append)
    run_cycles([cycle(0, [good("a", "AAA"), good("b", "BBB")])], d)
    assert any(r.get("reason") == "not_worth_trading" for r in log)


def test_judge_failure_skips_without_benching():
    log = []
    d = Desk(judge=StubJudge(fail_on="market"), log=log.append)
    run_cycles([cycle(0, [good("a", "AAA")]), cycle(1, [good("a", "AAA")])], d)
    failures = [r for r in log if r["event"] == "judge_failed"]
    assert len(failures) == 2  # retried next cycle, not benched


def test_kill_switch_flattens_open_position(tmp_path):
    kill = tmp_path / "KILL"
    log = []
    d = Desk(judge=StubJudge(pick_ticker="AAA"), log=log.append, kill_file=str(kill))
    d.step(0, [good("a", "AAA"), good("b", "BBB", volume_h24=300_000)], {})
    assert d.broker.position is not None
    kill.write_text("halt")
    d.step(1, [], {})
    closes = [r for r in log if r["event"] == "close"]
    assert closes[-1]["reason"] == "kill_switch"
    assert d.broker.position is None


def test_end_of_replay_flattens_and_cash_reconciles():
    d = Desk(judge=StubJudge(pick_ticker="AAA"))
    res = run_cycles([cycle(0, [good("a", "AAA"), good("b", "BBB", volume_h24=300_000)])], d)
    assert res["trades"][-1]["reason"] == "end_of_replay"
    assert res["cash"] == round(res["start_cash"] + sum(t["pnl_usd"] for t in res["trades"]), 2)


def test_evaluate_compares_desk_against_baseline(tmp_path):
    log = []
    d = Desk(judge=StubJudge(pick_ticker="AAA"), log=log.append)
    run_cycles([cycle(0, [good("a", "AAA", future={"60m": 1.2}),
                          good("b", "BBB", volume_h24=300_000, future={"60m": 0.9})])], d)
    summary = compare(log, "60m")
    assert summary["desk_opened"]["n"] == 1
    assert summary["desk_opened"]["mean"] == 0.2
    assert summary["baseline_hard_survivors"]["n"] == 2
    cal = judge_calibration(log, "shape.crowd")
    assert cal["n"] == 2
