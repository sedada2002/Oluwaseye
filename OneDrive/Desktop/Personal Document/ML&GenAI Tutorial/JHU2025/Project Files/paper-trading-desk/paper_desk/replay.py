"""Replay a recorded sequence of market cycles through the desk.

Input is JSONL, one cycle per line:
  {"t": <minutes>,
   "candidates": [{"tid", "ticker", "chain", "price_usd", "liquidity_usd", ...features...,
                   "future_prices": {"15m": p, "60m": p, "360m": p}}],
   "marks": {"<tid>": {"price": p, "liquidity_usd": l, "volume_h6": v, "volume_h24": v}}}

Nothing here fetches live data. Feeding it real snapshots is a separate adapter.
"""
import argparse
import json
import os
from collections import Counter

from . import config as C
from .broker import PaperBroker
from .funnel import free_kill, trade_kill, chain_kill, soft_kill
from .guardrails import Guardrails
from .judge import JudgeError


class Desk:
    def __init__(self, judge=None, log=None, kill_file=None,
                 hard=C.HardGates(), costs=C.Costs(), risk=C.Risk()):
        self.judge = judge            # None = funnel-only baseline, no judgement
        self.hard, self.costs, self.risk = hard, costs, risk
        self.broker = PaperBroker(costs, risk, cash=risk.bank_usd)
        self.guard = Guardrails(risk, kill_file, start_equity=self.broker.equity())
        self.bench = {}               # tid -> minute until which it stays rejected
        self._log = log or (lambda rec: None)
        self.stats = Counter()
        self.last_t = 0.0

    # ----- logging -----
    def _emit(self, t, event, **fields):
        self._log({"t": t, "event": event, **fields})

    # ----- one cycle -----
    def step(self, t, candidates, marks):
        self.last_t = t
        if self.broker.position:
            pos = self.broker.position
            if self.guard.kill_on():
                self._close(t, "kill_switch")
                return
            m = marks.get(pos.tid) or {}
            reason = self.broker.mark(t, price=m.get("price"),
                                      liquidity_usd=m.get("liquidity_usd"),
                                      volume_h6=m.get("volume_h6"),
                                      volume_h24=m.get("volume_h24"))
            if reason:
                self._close(t, reason)
            else:
                self._emit(t, "hold", tid=pos.tid, ticker=pos.ticker)
                self.stats["hold"] += 1
            return  # no scan while holding, and none in the cycle that closed

        if self.guard.kill_on():
            self._emit(t, "no_trade", reason="kill_switch")
            return

        survivors = []
        for c in candidates:
            survived = self._screen(t, c)
            if survived is not None:
                survivors.append(survived)

        if self.judge is None:
            self._emit(t, "no_trade", reason="funnel_only")
            return
        self._decide(t, survivors)

    def _screen(self, t, c):
        tid = c["tid"]
        if self.bench.get(tid, -1) > t:
            self.stats["benched"] += 1
            return None

        for stage in (lambda x: free_kill(x, self.hard),
                      lambda x: trade_kill(x, self.hard),
                      lambda x: chain_kill(x, self.hard)):
            reason = stage(c)
            if reason:
                self._reject(t, c, reason)
                return None

        self._emit(t, "survived_hard", tid=tid, ticker=c["ticker"], chain=c["chain"],
                   entry_price=c["price_usd"], fwd=c.get("future_prices", {}))
        self.stats["survived_hard"] += 1
        if self.judge is None:
            return None

        state = {k: v for k, v in c.items() if k != "future_prices"}
        answers = {}
        try:
            answers.update(self.judge.ask("market", state)["answers"])
            answers.update(self.judge.ask(C.CHAIN_QUESTION_SET[c["chain"]], state)["answers"])
        except (JudgeError, KeyError) as e:
            # no bench: the token is not at fault when the judge fails
            self._emit(t, "judge_failed", tid=tid, error=str(e))
            self.stats["judge_failed"] += 1
            return None

        self._emit(t, "judged", tid=tid, ticker=c["ticker"], answers=answers,
                   entry_price=c["price_usd"], fwd=c.get("future_prices", {}))
        reason = soft_kill(answers)
        if reason:
            self._reject(t, c, reason, answers=answers)
            return None
        return (c, answers)

    def _decide(self, t, survivors):
        if not survivors:
            self._emit(t, "no_trade", reason="no_survivors")
            return
        if len(survivors) == 1:
            # a choice over one option proves nothing; stand down, as the guide's rules say
            self._emit(t, "no_trade", reason="single_survivor")
            return

        summaries = [{"ticker": c["ticker"], "summary": _summary(c, a)} for c, a in survivors]
        try:
            r = self.judge.ask("pick", {"candidates": summaries})["answers"]
        except (JudgeError, KeyError) as e:
            self._emit(t, "no_trade", reason="pick_failed", error=str(e))
            return

        best, worth = r["best"], r["worth_trading_at_all"]
        self._emit(t, "pick_answer", best=best["choice"], confidence=best["confidence"],
                   worth=worth["noul"])
        if worth["noul"] < C.PICK_MIN_WORTH:
            self._emit(t, "no_trade", reason="not_worth_trading")
            return
        if best["confidence"] < C.PICK_MIN_CONF:
            self._emit(t, "no_trade", reason="low_pick_confidence")
            return

        match = next(((c, a) for c, a in survivors if c["ticker"] == best["choice"]), None)
        if match is None:
            self._emit(t, "no_trade", reason="pick_not_in_list")
            return
        c, answers = match

        ticket, factor = self._size(c, answers)
        fee_fraction = self.broker.fee(ticket) / ticket if ticket > 0 else 1.0
        if ticket <= 0 or fee_fraction > self.costs.max_fee_fraction:
            self._reject(t, c, "below_fee_floor", answers=answers, bench=False)
            return
        ok, why = self.guard.check_open(self.broker, ticket)
        if not ok:
            self._emit(t, "no_trade", reason=why, tid=c["tid"], ticker=c["ticker"])
            return

        pos = self.broker.open(c["tid"], c["ticker"], c["chain"], c["price_usd"],
                               c["liquidity_usd"], ticket, t)
        self._emit(t, "open", tid=c["tid"], ticker=c["ticker"], chain=c["chain"],
                   ticket_usd=ticket, size_factor=factor, fill=pos.entry_price,
                   confidence=best["confidence"], entry_price=c["price_usd"],
                   fwd=c.get("future_prices", {}), answers=answers)
        self.stats["open"] += 1

    def _size(self, c, answers):
        factor = 1.0
        if answers.get("data_coverage", {}).get("choice") == "dark":
            factor *= self.risk.dark_ticket_cut
        if "account_is_the_project" not in answers:
            factor *= self.risk.no_social_cut  # replays carry no X data, so this always applies
        ticket = self.risk.bank_usd * self.risk.max_position_fraction * factor
        ticket = min(ticket, c["liquidity_usd"] * self.risk.max_liquidity_fraction)
        return round(ticket, 2), round(factor, 2)

    def _reject(self, t, c, reason, answers=None, bench=True):
        if bench:
            mins = C.BENCH_MINUTES.get(reason, C.DEFAULT_BENCH_MINUTES)
            self.bench[c["tid"]] = t + mins
        self._emit(t, "reject", tid=c["tid"], ticker=c["ticker"], reason=reason,
                   fwd=c.get("future_prices", {}), entry_price=c.get("price_usd"),
                   answers=answers or {})
        self.stats[f"reject:{reason}"] += 1

    def _close(self, t, reason):
        trade = self.broker.close(t, reason)
        self._emit(t, "close", **trade)
        self.stats["close"] += 1

    def finish(self):
        """End of replay: flatten anything still held so the result is complete."""
        if self.broker.position:
            self._close(self.last_t, "end_of_replay")
        return {"cash": round(self.broker.cash, 2),
                "start_cash": round(self.broker.start_cash, 2),
                "trades": self.broker.trades,
                "stats": dict(self.stats)}


def _summary(c, a):
    """Two short lines per candidate, built from judge answers. Never the raw dossier."""
    bits = [f"{c['chain']}, {c['age_minutes']:.0f}m old, ${c['mcap_usd']:,.0f} mcap, "
            f"${c['liquidity_usd']:,.0f} liq",
            f"crowd {a['shape']['probabilities']['crowd']:.2f}, "
            f"concentration risk {a['concentration_is_exit_risk']['noul']:.2f}"]
    if "authority_risk" in a:
        bits.append(f"authority {a['authority_risk']['choice']}")
    if "sell_side_risk" in a:
        bits.append(f"sell side {a['sell_side_risk']['choice']}")
    return "; ".join(bits)


def run_cycles(cycles, desk):
    for cyc in cycles:
        desk.step(cyc["t"], cyc.get("candidates", []), cyc.get("marks", {}))
    return desk.finish()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Replay recorded cycles through the paper desk.")
    ap.add_argument("--data", required=True, help="JSONL of cycles")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--judge", choices=["none", "http"], default="none")
    ap.add_argument("--kill-file", default=None, help="create this file to halt the desk")
    args = ap.parse_args(argv)

    judge = None
    if args.judge == "http":
        from .judge import HttpJudge
        judge = HttpJudge(os.environ["JUDGE_URL"], os.environ["DESK_SECRET"])

    os.makedirs(args.out, exist_ok=True)
    log_path = os.path.join(args.out, "decisions.jsonl")
    with open(log_path, "w", encoding="utf-8") as log_f, open(args.data, encoding="utf-8-sig") as data_f:
        def log(rec):
            log_f.write(json.dumps(rec, default=str) + "\n")

        cycles = [json.loads(line) for line in data_f if line.strip()]
        desk = Desk(judge=judge, log=log, kill_file=args.kill_file)
        result = run_cycles(cycles, desk)

    with open(os.path.join(args.out, "result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, default=str)
    print(json.dumps({"stats": result["stats"], "trades": len(result["trades"]),
                      "cash": result["cash"], "start_cash": result["start_cash"]}, indent=2))
    print(f"decision log: {log_path}")


if __name__ == "__main__":
    main()
