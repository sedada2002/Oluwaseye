# QuantFlow — point-in-time growth screen vs SPY

Backtests the QuantFlow growth screen with real risk rules and compares it to SPY on
Sharpe, max drawdown, and sector concentration.

**Screen** (monthly, on the close): as-reported TTM revenue CAGR > 20% over 3 years,
debt/equity < 0.5, 126-day return above SPY. Ranked by relative strength.

**Risk rules** (enforced in `quantflow/engine.py`):
- 1% of equity at risk per trade: `shares = floor(0.01 × equity / (3 × ATR14))`
- Initial and trailing stop at 3 × ATR(14) (Pine `ta.atr`, Wilder RMA); the trailing stop only ratchets up
- Sell 50% at +20%, then move the stop to break-even
- Entries fill at the next session's open; the stop is checked before the target inside a bar

## No look-ahead, no survivorship bias

- Fundamentals come from Sharadar SF1 dimension `ART` (as reported, never restated).
  A filing is only visible on or after its `datekey`, the date it went public.
  The base-period filing for the CAGR must also be public by the screen date.
- Prices come from Sharadar SEP, which includes delisted tickers. A name that stops
  trading is closed at its last price (real delisting returns can be worse; the report says so).

## Setup

```bash
pip install -e ".[api,dev]"
cp .env.example .env          # put NASDAQ_DATA_LINK_API_KEY in .env, never commit it
```

You need a Nasdaq Data Link subscription that covers Sharadar SF1, SEP, SFP and TICKERS
(the Core US Equities Bundle). A free key alone gets 403s.

## Run

```bash
quantflow --synthetic --out reports/dry_run.html          # no key: mechanics check only
quantflow --start 2012-01-01 --end 2026-10-31 --out reports/quantflow_vs_spy.html
```

The first real run downloads the full SF1 ART table plus prices for every ticker that
ever passes the fundamental legs. It's cached under `.cache/sharadar/`, so later runs
are fast. Delete the cache to refresh.

Outputs: the HTML report, `*.trades.csv` (every round trip), `*.screens.csv` (every
screen pass with CAGR, D/E, RS).

### API (key stays server-side)

```bash
uvicorn quantflow.api:app --port 8000
curl -X POST localhost:8000/backtest -H 'content-type: application/json' -d '{"start":"2015-01-01"}'
curl -X POST localhost:8000/backtest/report -H 'content-type: application/json' -d '{}' > report.html
```

## Test

```bash
pytest          # look-ahead, risk rules, metrics, adapter (mocked HTTP), API
mypy quantflow  # strict
```

## Known limits

- Dividends are excluded on both sides (price return vs price return).
- Daily bars can't tell whether the stop or the target hit first in a bar; the engine assumes the stop.
- Slippage is a flat 5 bps; small caps will cost more.
- Sharadar's license bars publishing evaluations of its data without permission.

Data from [Sharadar](http://www.sharadar.com).
