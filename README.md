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

## Data sources

| | `--source free` | `--source sharadar` |
|---|---|---|
| Cost | $0 | Paid Nasdaq Data Link subscription |
| Fundamentals | SEC EDGAR XBRL, as originally filed | Sharadar SF1 `ART`, as reported |
| Prices | Alpaca (from 2016) | Sharadar SEP/SFP (from 1998) |
| Delisted companies | **Mostly missing** (survivorship bias) | Included |
| Use it for | Go / no-go: is the screen worth paying for? | Trusting the final number |

Both paths are point-in-time: a filing is only visible on or after the day it went
public (`filed` on EDGAR, `datekey` on Sharadar), and the base-period filing for the
CAGR must also be public by the screen date. Later restatements never leak backwards.

EDGAR details: TTM revenue is the reported fiscal year, or the sum of the last four
quarters, with Q4 derived as FY minus Q1-Q3 when it isn't tagged. Revenue concepts are
merged across the 2018 ASC 606 switch. D/E = total liabilities / stockholders' equity.
Sectors come from SIC codes mapped to broad buckets.

A name whose prices stop (delisting) is closed at its last price. Real delisting
returns can be worse, and the report says so.

## Setup

```bash
pip install -e ".[api,dev]"
cp .env.example .env          # fill in keys; never commit .env
```

Free path needs:
- `SEC_USER_AGENT` - a name and contact email, e.g. `QuantFlow research you@example.com` (SEC rule)
- `APCA_API_KEY_ID` / `APCA_API_SECRET_KEY` - free Alpaca account; paper-trading keys work.
  If Alpaca rejects the `sip` feed on your plan, set `ALPACA_DATA_FEED=iex`.

Sharadar path needs `NASDAQ_DATA_LINK_API_KEY` with a subscription covering SF1,
SEP, SFP and TICKERS. A key without the subscription gets 403s.

## Run

```bash
quantflow --source synthetic --out reports/dry_run.html                  # no keys, mechanics only
quantflow --source free --start 2016-09-01 --out reports/free.html       # $0 go/no-go test
quantflow --source sharadar --start 2012-01-01 --out reports/sharadar.html
```

First free run: about 6,000 SEC requests at 8 per second (roughly 15 minutes), then
Alpaca prices for the candidates. Parsed results are cached under `.cache/`, so later
runs take seconds. Delete `.cache/` to refresh.

Outputs: the HTML report, `*.trades.csv` (every round trip), `*.screens.csv` (every
screen pass with CAGR, D/E, RS).

### API (key stays server-side)

```bash
uvicorn quantflow.api:app --port 8000
curl -X POST localhost:8000/backtest -H 'content-type: application/json' -d '{"source":"free","start":"2016-09-01"}'
curl -X POST localhost:8000/backtest/report -H 'content-type: application/json' -d '{"source":"free"}' > report.html
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
- Free data: survivorship bias and history from 2016 only (about two full market regimes).
- Sharadar's license bars publishing evaluations of its data without permission.

Data from [Sharadar](http://www.sharadar.com) when run with `--source sharadar`.
