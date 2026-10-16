"""Filter stages. Each returns a kill reason string, or None if the token survives.

Missing numeric data fails closed: a null field is a reason to reject, never a pass.
"""
from .config import HardGates, SOFT_GATES, SHAPE_MIN_CROWD


def _need(t, key):
    v = t.get(key)
    if v is None:
        raise KeyError(key)
    return v


def free_kill(t, hard=HardGates()):
    """Pass one: fields that arrive with the universe batch. No network."""
    try:
        if not hard.min_age_minutes <= _need(t, "age_minutes") <= hard.max_age_hours * 60:
            return "age"
        if _need(t, "liquidity_usd") < hard.min_liquidity_usd:
            return "liquidity"
        if _need(t, "volume_h24") < hard.min_volume_h24:
            return "volume"
        if not hard.min_mcap_usd <= _need(t, "mcap_usd") <= hard.max_mcap_usd:
            return "mcap"
    except KeyError as missing:
        return f"missing_{missing.args[0]}"
    return None


def trade_kill(t, hard=HardGates()):
    """Pass two: trade-count data from DexScreener."""
    if t.get("trades_h24") is None:
        return "no_pair"
    if t["trades_h24"] < hard.min_trades_h24:
        return "trades"
    if t.get("sells_h1") == 0 and (t.get("buys_h1") or 0) > 20:
        return "no_sells"
    return None


def chain_kill(t, hard=HardGates()):
    """Post-dossier facts. Still no judgement involved."""
    tw = t.get("top_wallet_percent")
    if tw is not None and tw > hard.max_top_wallet:
        return "top_wallet"
    t10 = t.get("top_10_percent")
    if t10 is not None and float(t10) > hard.max_top_10_pct:
        return "top_10"
    hc = t.get("holder_count")
    if hc is not None and hc < hard.min_holders:
        return "holders"
    if t.get("chain") == "solana" and (t.get("mint_authority") or t.get("freeze_authority")):
        return "authority_open"
    if t.get("chain") in ("bsc", "base") and t.get("is_honeypot") is True:
        return "honeypot"
    return None


def soft_kill(answers, gates=SOFT_GATES, shape_min_crowd=SHAPE_MIN_CROWD):
    """Judge answers against thresholds. First failure wins."""
    for name, (direction, limit) in gates.items():
        a = answers.get(name)
        if a is None:
            continue  # question was not asked for this chain
        v = a.get("noul", a.get("score"))
        if v is None:
            continue
        if direction == "max" and v > limit:
            return name
        if direction == "min" and v < limit:
            return name

    shape = answers.get("shape")
    if shape:
        if shape["choice"] in ("fading", "one_buyer"):
            return "shape"
        if shape["probabilities"]["crowd"] < shape_min_crowd:
            return "shape_weak"

    sell = answers.get("sell_side_risk")
    if sell and sell["choice"] in ("flagged", "suspicious"):
        return "sell_side"
    return None
