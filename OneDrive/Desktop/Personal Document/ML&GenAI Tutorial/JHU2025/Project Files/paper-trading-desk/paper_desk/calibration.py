"""Calibration: does a judge probability of 0.7 come true about 70% of the time?

pairs = [(predicted_probability, outcome_0_or_1), ...]
"""


def _check(pairs):
    for p, y in pairs:
        if not 0.0 <= p <= 1.0:
            raise ValueError(f"probability out of range: {p}")
        if y not in (0, 1):
            raise ValueError(f"outcome must be 0 or 1: {y}")


def brier(pairs) -> float | None:
    """Mean squared error of the probabilities. 0 is perfect, 0.25 is always-0.5."""
    if not pairs:
        return None
    _check(pairs)
    return sum((p - y) ** 2 for p, y in pairs) / len(pairs)


def reliability(pairs, bins: int = 10) -> list[dict]:
    _check(pairs)
    out = []
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        members = [(p, y) for p, y in pairs
                   if lo <= p < hi or (i == bins - 1 and p == 1.0)]
        if not members:
            out.append({"lo": lo, "hi": hi, "n": 0, "mean_p": None, "hit_rate": None})
            continue
        out.append({"lo": lo, "hi": hi, "n": len(members),
                    "mean_p": sum(p for p, _ in members) / len(members),
                    "hit_rate": sum(y for _, y in members) / len(members)})
    return out


def expected_calibration_error(pairs, bins: int = 10) -> float | None:
    """Weighted average gap between predicted and observed rate, across bins."""
    if not pairs:
        return None
    n = len(pairs)
    return sum(b["n"] * abs(b["mean_p"] - b["hit_rate"])
               for b in reliability(pairs, bins) if b["n"]) / n
