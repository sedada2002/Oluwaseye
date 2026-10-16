from paper_desk.funnel import free_kill, trade_kill, chain_kill, soft_kill


def healthy(**over):
    t = {"age_minutes": 120, "liquidity_usd": 50_000, "volume_h24": 200_000,
         "mcap_usd": 500_000, "trades_h24": 900, "buys_h1": 40, "sells_h1": 25,
         "chain": "solana", "holder_count": 300, "top_10_percent": 30,
         "top_wallet_percent": 0.02, "mint_authority": None, "freeze_authority": None,
         "is_honeypot": None}
    t.update(over)
    return t


def test_healthy_token_survives_every_hard_stage():
    t = healthy()
    assert free_kill(t) is None
    assert trade_kill(t) is None
    assert chain_kill(t) is None


def test_free_kill_reasons():
    assert free_kill(healthy(age_minutes=5)) == "age"
    assert free_kill(healthy(liquidity_usd=1_000)) == "liquidity"
    assert free_kill(healthy(volume_h24=100)) == "volume"
    assert free_kill(healthy(mcap_usd=10_000_000)) == "mcap"


def test_missing_numeric_field_fails_closed():
    t = healthy()
    t["liquidity_usd"] = None
    assert free_kill(t) == "missing_liquidity_usd"


def test_trade_kill_no_pair_and_no_sells():
    assert trade_kill(healthy(trades_h24=None)) == "no_pair"
    assert trade_kill(healthy(sells_h1=0, buys_h1=50)) == "no_sells"


def test_chain_kill_authority_and_honeypot():
    assert chain_kill(healthy(mint_authority="abc")) == "authority_open"
    assert chain_kill(healthy(chain="bsc", is_honeypot=True)) == "honeypot"
    assert chain_kill(healthy(chain="bsc", is_honeypot=False)) is None


def test_chain_kill_concentration_units_are_percent():
    # GeckoTerminal reports percent, so 70 means 70% held by the top 10
    assert chain_kill(healthy(top_10_percent=70)) == "top_10"
    assert chain_kill(healthy(top_10_percent=55)) is None


def test_soft_kill_shape_and_gate():
    assert soft_kill({"shape": {"choice": "fading", "probabilities": {"crowd": 0.1}}}) == "shape"
    weak = {"shape": {"choice": "crowd", "probabilities": {"crowd": 0.4}}}
    assert soft_kill(weak) == "shape_weak"
    assert soft_kill({"concentration_is_exit_risk": {"noul": 0.9}}) == "concentration_is_exit_risk"
    assert soft_kill({"concentration_is_exit_risk": {"noul": 0.1}}) is None


def test_soft_kill_skips_unasked_questions():
    assert soft_kill({}) is None
