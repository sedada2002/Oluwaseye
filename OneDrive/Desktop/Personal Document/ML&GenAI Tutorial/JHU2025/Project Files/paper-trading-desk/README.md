# Paper-trading desk

A replay-and-simulate harness for the funnel described in the memecoin bot guide.
**Paper money only.** There is no live execution, no exchange connection, and no
referral links. Its job is to answer one question before any real money is involved:
does the judge's filtering beat a no-judge baseline on recorded data?

## What it does

- **Funnel** (`paper_desk/funnel.py`): free checks, then trade-count checks, then
  chain-fact checks, then judge soft gates. Missing numeric data fails closed.
- **Simulated broker** (`paper_desk/broker.py`): fills with proportional slippage,
  fee floor, stop-loss, take-profit, time stop, volume-dried exit, and a missing-data
  exit. Cash reconciles to the sum of trade P&L.
- **Guardrails** (`paper_desk/guardrails.py`): a kill-file that blocks new opens and
  flattens any open position, a session loss limit, and cash checks.
- **Calibration** (`paper_desk/calibration.py`): Brier score, reliability bins, and
  expected calibration error, so a judge "0.7" can be checked against outcomes.
- **Evaluation** (`paper_desk/evaluate.py`): compares tokens the desk opened against
  every token that survived the hard gates. If the desk cannot beat that baseline,
  the judge adds nothing.

## Run it

```bash
pip install -r requirements.txt
python -m pytest tests
python -m paper_desk.replay --data cycles.jsonl --out runs/first        # funnel only
python -m paper_desk.replay --data cycles.jsonl --out runs/judged --judge http   # needs JUDGE_URL, DESK_SECRET
python -m paper_desk.evaluate --log runs/judged/decisions.jsonl --calibrate shape.crowd
```

Create a file named `KILL` and pass `--kill-file KILL` to halt the desk mid-replay.

## Input format

One JSON object per line. Each line is a cycle:

```json
{"t": 0, "candidates": [{"tid": "...", "ticker": "...", "chain": "solana",
  "price_usd": 1.0, "age_minutes": 120, "liquidity_usd": 50000, "volume_h24": 200000,
  "mcap_usd": 500000, "trades_h24": 900, "buys_h1": 40, "sells_h1": 25,
  "holder_count": 300, "top_10_percent": 30, "top_wallet_percent": 0.02,
  "mint_authority": null, "freeze_authority": null,
  "future_prices": {"60m": 1.1}}], "marks": {"<tid>": {"price": 1.2,
  "liquidity_usd": 50000, "volume_h6": 9000, "volume_h24": 200000}}}
```

`future_prices` is only needed for evaluation. Windows PowerShell writes a byte-order
mark by default, and the readers accept it.

## What is not here, and why

- **No live data collection.** The guide's collectors (FOMO, GeckoTerminal, DexScreener,
  Solana RPC) would need your own sessions and keys. Recording snapshots is a separate
  step, and it's where the data-quality problems will show up first.
- **No judge server.** The Typesafe SDK, its question definitions, and the `pick`
  question live on the judge side. `HttpJudge` only speaks the request/response shape
  the guide describes. Those definitions have not been verified against the live API.
- **No social (X) data.** Replays run with the no-social size cut applied to every trade.
- **Thresholds are not validated.** Every number in `config.py` came from the guide and
  was tuned on the author's own launches and bank. Treat them as placeholders until
  calibration and evaluation on your own recorded data say otherwise.

## Known limits of the simulation

- Fills use a linear slippage model. Thin pools will move more than this predicts.
- Stop-loss exits fill at the marked price. Gaps through the stop are not modelled.
- Forward returns in `evaluate.py` are gross: no fees, no slippage. Real results are lower.
- A small sample proves nothing. Read `n` before reading `mean`.
