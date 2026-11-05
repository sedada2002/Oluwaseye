"""Daily bars from Alpaca Market Data v2 (free with an Alpaca account).

Keys come from APCA_API_KEY_ID / APCA_API_SECRET_KEY in the backend .env.
Paper-trading keys work for market data, so no live account is needed.

Limits:
  - History starts in 2016, so backtests can't start much earlier than mid-2016
    (the screen needs ~6 months of prices for relative strength).
  - Coverage of delisted symbols is incomplete -> survivorship bias.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Sequence

import pandas as pd
import requests

from quantflow.data.base import PRICE_COLUMNS, validate

BARS_URL = "https://data.alpaca.markets/v2/stocks/bars"
SYMBOL_BATCH = 50
EARLIEST = "2016-01-01"


class AlpacaError(RuntimeError):
    pass


def bars_to_frame(payload_bars: dict[str, list[dict[str, Any]]]) -> pd.DataFrame:
    rows = [
        {"ticker": sym, "date": b["t"], "open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"]}
        for sym, bars in payload_bars.items()
        for b in bars
    ]
    df = pd.DataFrame(rows, columns=PRICE_COLUMNS)
    if df.empty:
        return df
    # Daily bar timestamps are midnight New York time expressed in UTC
    ts = pd.to_datetime(df["date"], utc=True).dt.tz_convert("America/New_York")
    df["date"] = ts.dt.tz_localize(None).dt.normalize()
    return df


def recent_safe_end(end: str, now: pd.Timestamp | None = None) -> str:
    """Free Alpaca plans refuse SIP data from the last 15 minutes (HTTP 403). If the
    request reaches today, end it 16 minutes ago instead. Historical ends pass through."""
    now = now or pd.Timestamp.now(tz="UTC")
    cutoff = now - pd.Timedelta(minutes=16)
    if pd.Timestamp(end).tz_localize("America/New_York").tz_convert("UTC") + pd.Timedelta(days=1) <= cutoff:
        return end
    return cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")


class AlpacaPrices:
    def __init__(
        self,
        key_id: str | None = None,
        secret: str | None = None,
        feed: str | None = None,
        cache_dir: str | os.PathLike[str] | None = None,
        session: requests.Session | None = None,
    ) -> None:
        kid = key_id or os.environ.get("APCA_API_KEY_ID")
        sec = secret or os.environ.get("APCA_API_SECRET_KEY")
        if not kid or not sec:
            raise AlpacaError("APCA_API_KEY_ID / APCA_API_SECRET_KEY are not set in the backend .env")
        self._session = session or requests.Session()
        self._session.headers.update({"APCA-API-KEY-ID": kid, "APCA-API-SECRET-KEY": sec})
        self._feed = feed or os.environ.get("ALPACA_DATA_FEED", "sip")
        base = Path(cache_dir or os.environ.get("QUANTFLOW_CACHE_DIR", ".cache")) / "alpaca"
        base.mkdir(parents=True, exist_ok=True)
        self._cache = base

    def prices(self, tickers: Sequence[str], start: str, end: str) -> pd.DataFrame:
        start = max(start, EARLIEST)
        end = recent_safe_end(end)
        symbols = sorted({t.replace("-", ".") for t in tickers})   # Alpaca uses BRK.B
        frames: list[pd.DataFrame] = []
        for i in range(0, len(symbols), SYMBOL_BATCH):
            frames.append(self._batch(symbols[i : i + SYMBOL_BATCH], start, end))
        df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=PRICE_COLUMNS)
        df["ticker"] = df["ticker"].str.replace(".", "-", regex=False)
        return validate(df, PRICE_COLUMNS, "prices").sort_values(["ticker", "date"])

    def _batch(self, symbols: list[str], start: str, end: str) -> pd.DataFrame:
        key = hashlib.sha256(json.dumps([symbols, start, end, self._feed]).encode()).hexdigest()[:20]
        cache_file = self._cache / f"bars_{key}.csv.gz"
        if cache_file.exists():
            return pd.read_csv(cache_file, compression="gzip", parse_dates=["date"])
        bars: dict[str, list[dict[str, Any]]] = {}
        token: str | None = None
        while True:
            params = {"symbols": ",".join(symbols), "timeframe": "1Day", "start": start, "end": end,
                      "adjustment": "split", "feed": self._feed, "limit": "10000"}
            if token:
                params["page_token"] = token
            payload = self._get(params)
            for sym, b in (payload.get("bars") or {}).items():
                bars.setdefault(sym, []).extend(b)
            token = payload.get("next_page_token")
            if not token:
                break
        df = bars_to_frame(bars)
        df.to_csv(cache_file, index=False, compression="gzip")
        return df

    def _get(self, params: dict[str, str]) -> dict[str, Any]:
        for attempt in range(6):
            resp = self._session.get(BARS_URL, params=params, timeout=60)
            if resp.status_code == 429 or resp.status_code >= 500:
                time.sleep(min(30, 2 ** attempt))
                continue
            if resp.status_code in (401, 403):
                raise AlpacaError(
                    f"Alpaca refused the request ({resp.status_code}: {resp.text[:200]}). Check the "
                    "keys; if the message mentions the SIP feed, set ALPACA_DATA_FEED=iex."
                )
            if not resp.ok:
                raise AlpacaError(f"Alpaca error {resp.status_code}: {resp.text[:200]}")
            data: dict[str, Any] = resp.json()
            return data
        raise AlpacaError("Alpaca rate limit or server error after retries")
