"""Score a decision log against what happened next.

Compares tokens the desk actually opened against every token that survived the
hard gates (the baseline). If the desk cannot beat the baseline, the judge is adding
nothing, however good the trades look on their own.

Forward returns are gross: no fees or slippage. Real results will be lower.
"""
import argparse
import json
import statistics

from .calibration import brier, expected_calibration_error


def load_log(path):
    with open(path, encoding="utf-8-sig") as f:
        return [json.loads(line) for line in f if line.strip()]


def forward_returns(entry_price, fwd: dict) -> dict:
    if not entry_price:
        return {}
    return {h: p / entry_price - 1 for h, p in fwd.items() if p}


def summarize(returns: list[float]) -> dict:
    if not returns:
        return {"n": 0, "mean": None, "median": None, "hit_rate": None}
    return {"n": len(returns),
            "mean": round(statistics.fmean(returns), 4),
            "median": round(statistics.median(returns), 4),
            "hit_rate": round(sum(r > 0 for r in returns) / len(returns), 4)}


def compare(records, horizon="60m") -> dict:
    baseline = [r for r in records if r["event"] == "survived_hard"]
    opened = [r for r in records if r["event"] == "open"]

    def rets(rs):
        out = []
        for r in rs:
            v = forward_returns(r.get("entry_price"), r.get("fwd", {})).get(horizon)
            if v is not None:
                out.append(v)
        return out

    return {"horizon": horizon,
            "baseline_hard_survivors": summarize(rets(baseline)),
            "desk_opened": summarize(rets(opened)),
            "note": "gross, no fees or slippage; small samples prove nothing"}


def probability_of(answers: dict, name: str):
    """'shape.crowd' reads probabilities; 'liquidity_fits_ticket' reads the noul."""
    if "." in name:
        head, key = name.split(".", 1)
        a = answers.get(head)
        return None if a is None else a.get("probabilities", {}).get(key)
    a = answers.get(name)
    return None if a is None else a.get("noul", a.get("score"))


def judge_calibration(records, name: str, horizon="60m", label_threshold=0.0) -> dict:
    """Does the judge's probability for `name` match how often the 60m return was positive?

    Uses every token the judge scored, including ones it then rejected, so the sample
    is not filtered by the soft gates being checked."""
    pairs = []
    for r in records:
        if r["event"] != "judged" or not r.get("answers"):
            continue
        p = probability_of(r["answers"], name)
        v = forward_returns(r.get("entry_price"), r.get("fwd", {})).get(horizon)
        if p is None or v is None:
            continue
        pairs.append((p, 1 if v > label_threshold else 0))
    return {"judge_field": name, "n": len(pairs),
            "brier": brier(pairs) if pairs else None,
            "ece": expected_calibration_error(pairs) if pairs else None}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Evaluate a paper-desk decision log.")
    ap.add_argument("--log", required=True)
    ap.add_argument("--horizon", default="60m")
    ap.add_argument("--calibrate", default="shape.crowd",
                    help="judge field to check for calibration")
    args = ap.parse_args(argv)
    records = load_log(args.log)
    print(json.dumps(compare(records, args.horizon), indent=2))
    print(json.dumps(judge_calibration(records, args.calibrate, args.horizon), indent=2))


if __name__ == "__main__":
    main()
