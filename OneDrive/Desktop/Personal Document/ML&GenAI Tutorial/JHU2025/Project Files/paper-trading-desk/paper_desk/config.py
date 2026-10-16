"""Every tunable number lives here.

These are starting points carried over from the guide. They are NOT validated edges.
Calibrate them against your own logged outcomes before trusting any of them.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class HardGates:
    """Facts-based gates. Arithmetic only, no model judgement."""
    min_age_minutes: float = 15
    max_age_hours: float = 72
    min_liquidity_usd: float = 12_000
    min_volume_h24: float = 40_000
    min_mcap_usd: float = 60_000
    max_mcap_usd: float = 8_000_000
    min_trades_h24: int = 150
    max_top_wallet: float = 0.05      # fraction; Solana only
    max_top_10_pct: float = 60.0      # GeckoTerminal reports percent
    min_holders: int = 80


@dataclass(frozen=True)
class Costs:
    fee_rate: float = 0.0045
    fee_floor_usd: float = 0.95
    max_fee_fraction: float = 0.05    # skip if one-way fee is more than this share of the ticket
    slippage_per_liquidity: float = 1.0  # impact = slippage_per_liquidity * ticket / liquidity


@dataclass(frozen=True)
class Risk:
    bank_usd: float = 1000.0
    max_position_fraction: float = 0.06
    max_liquidity_fraction: float = 0.02
    dark_ticket_cut: float = 0.40
    no_social_cut: float = 0.60
    stop_loss: float = -0.30          # fraction of entry price
    take_profit: float = 0.50
    max_hold_minutes: float = 120.0
    volume_ratio_exit: float = 0.20   # volume_h6 / (volume_h24 / 4)
    max_missing_marks: int = 3
    session_loss_limit_usd: float = 100.0


# Judge answers checked against thresholds. (direction, limit)
SOFT_GATES = {
    "concentration_is_exit_risk": ("max", 0.55),
    "momentum_already_spent": ("max", 0.60),
    "liquidity_fits_ticket": ("min", 0.60),
    "account_is_the_project": ("min", 0.70),
    "recycled_account": ("max", 0.50),
    "audience_is_real": ("min", 0.45),
    "effort": ("min", 1.0),
    "dev_still_loaded": ("max", 0.55),
    "sellable_by_evidence": ("min", 0.60),
}

SHAPE_MIN_CROWD = 0.55
PICK_MIN_WORTH = 0.60
PICK_MIN_CONF = 0.55

# How long a rejection stands, keyed by the check that fired (minutes).
# Facts that cannot change stay benched longest; fast-moving checks come back quickly.
BENCH_MINUTES = {
    "honeypot": 100_000, "authority_open": 100_000,
    "top_wallet": 100_000, "sell_side": 100_000,
    "recycled_account": 360, "account_is_the_project": 360,
    "top_10": 90, "holders": 90, "dev_still_loaded": 90,
    "concentration_is_exit_risk": 90,
    "shape": 25, "shape_weak": 25, "momentum_already_spent": 25,
    "liquidity_fits_ticket": 25, "liquidity": 25, "volume": 25,
    "trades": 25, "mcap": 25, "age": 20,
}
DEFAULT_BENCH_MINUTES = 45

# Chain name -> judge question set. Base shares the BSC set, as in the guide.
CHAIN_QUESTION_SET = {"solana": "solana", "bsc": "bsc", "base": "bsc", "robinhood": "robinhood"}
