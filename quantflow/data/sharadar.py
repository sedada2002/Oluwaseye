"""Sharadar adapter over the Nasdaq Data Link datatables REST API.

Backend-only. The API key comes from NASDAQ_DATA_LINK_API_KEY and is never logged,
cached, or returned to a client.

Tables used:
  SHARADAR/TICKERS  universe + sector + delisted flag
  SHARADAR/SF1      fundamentals, dimension ART (As-Reported, Trailing twelve months).
                    AR* dimensions are not restated, so a row reflects what was filed.
  SHARADAR/SEP      equity prices (includes delisted tickers -> no survivorship bias)
  SHARADAR/SFP      fund prices (SPY lives here)

Data from Sharadar (https://www.sharadar.com). Attribution is required by the license.
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

from quantflow.data.base import (
    FUNDAMENTAL_COLUMNS,
    PRICE_COLUMNS,
    UNIVERSE_COLUMNS,
    sectors_from_universe,
    validate,
)

BASE_URL = "https://data.nasdaq.com/api/v3/datatables"
COMMON_STOCK_PREFIX = "Domestic Common Stock"
TICKER_BATCH = 100
PER_PAGE = 10_000


class SharadarError(RuntimeError):
    pass


class SharadarProvider:
    def __init__(
        self,
        api_key: str | None = None,
        cache_dir: str | os.PathLike[str] | None = None,
        session: requests.Session | None = None,
        max_retries: int = 4,
        max_age_days: float | None = None,
    ) -> None:
        key = api_key or os.environ.get("NASDAQ_DATA_LINK_API_KEY")
        if not key:
            raise SharadarError(
                "NASDAQ_DATA_LINK_API_KEY is not set. Put it in the backend .env; "
                "never in frontend code."
            )
        self._key = key
        self._session = session or requests.Session()
        self._max_retries = max_retries
        self._max_age = max_age_days
        cache = cache_dir or os.environ.get("QUANTFLOW_CACHE_DIR", ".cache/sharadar")
        self._cache = Path(cache)
        self._cache.mkdir(parents=True, exist_ok=True)

    # ---- public API -------------------------------------------------------

    def universe(self) -> pd.DataFrame:
        df = self._table(
            "SHARADAR/TICKERS",
            {"table": "SF1", "qopts.columns": "ticker,category,sector,isdelisted"},
        )
        df = df[df["category"].astype(str).str.startswith(COMMON_STOCK_PREFIX)]
        df["isdelisted"] = df["isdelisted"].astype(str).str.upper().eq("Y")
        df["sector"] = df["sector"].fillna("Unknown")
        return validate(df.drop_duplicates("ticker"), UNIVERSE_COLUMNS, "universe")

    def sectors(self, tickers: Sequence[str]) -> dict[str, str]:
        return sectors_from_universe(self.universe(), tickers)

    def fundamentals(self) -> pd.DataFrame:
        df = self._table(
            "SHARADAR/SF1",
            {"dimension": "ART", "qopts.columns": ",".join(FUNDAMENTAL_COLUMNS)},
        )
        for col in ("calendardate", "datekey"):
            df[col] = pd.to_datetime(df[col])
        return validate(df, FUNDAMENTAL_COLUMNS, "fundamentals")

    def prices(self, tickers: Sequence[str], start: str, end: str) -> pd.DataFrame:
        wanted = sorted(set(tickers))
        frames: list[pd.DataFrame] = []
        found: set[str] = set()
        for table in ("SHARADAR/SEP", "SHARADAR/SFP"):
            remaining = [t for t in wanted if t not in found]
            for i in range(0, len(remaining), TICKER_BATCH):
                batch = remaining[i : i + TICKER_BATCH]
                part = self._table(
                    table,
                    {
                        "ticker": ",".join(batch),
                        "date.gte": start,
                        "date.lte": end,
                        "qopts.columns": ",".join(PRICE_COLUMNS),
                    },
                )
                if not part.empty:
                    frames.append(part)
                    found.update(part["ticker"].unique())
        if not frames:
            return pd.DataFrame(columns=PRICE_COLUMNS)
        df = pd.concat(frames, ignore_index=True)
        df["date"] = pd.to_datetime(df["date"])
        return validate(df, PRICE_COLUMNS, "prices").sort_values(["ticker", "date"])

    # ---- transport ----------------------------------------------------------

    def _table(self, table: str, params: dict[str, str]) -> pd.DataFrame:
        cache_file = self._cache_path(table, params)
        if cache_file.exists() and (
            self._max_age is None or (time.time() - cache_file.stat().st_mtime) / 86400 < self._max_age
        ):
            return pd.read_csv(cache_file, compression="gzip")

        rows: list[list[Any]] = []
        columns: list[str] = []
        cursor: str | None = None
        while True:
            query = dict(params, **{"qopts.per_page": str(PER_PAGE)})
            if cursor:
                query["qopts.cursor_id"] = cursor
            payload = self._get(f"{BASE_URL}/{table}.json", query)
            datatable = payload.get("datatable", {})
            columns = [c["name"] for c in datatable.get("columns", [])]
            rows.extend(datatable.get("data", []))
            cursor = (payload.get("meta") or {}).get("next_cursor_id")
            if not cursor:
                break

        df = pd.DataFrame(rows, columns=columns)
        df.to_csv(cache_file, index=False, compression="gzip")
        return df

    def _get(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        query = dict(params, api_key=self._key)
        for attempt in range(self._max_retries + 1):
            resp = self._session.get(url, params=query, timeout=60)
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == self._max_retries:
                    break
                time.sleep(2**attempt)
                continue
            if resp.status_code in (401, 403):
                raise SharadarError(
                    f"Nasdaq Data Link refused the request ({resp.status_code}). "
                    "Check the key and that your Sharadar subscription covers this table."
                )
            if not resp.ok:
                # Never include the URL: it carries the key.
                raise SharadarError(f"Nasdaq Data Link error {resp.status_code}")
            data: dict[str, Any] = resp.json()
            return data
        raise SharadarError("Nasdaq Data Link rate limit or server error after retries")

    def _cache_path(self, table: str, params: dict[str, str]) -> Path:
        digest = hashlib.sha256(
            json.dumps([table, sorted(params.items())]).encode()
        ).hexdigest()[:20]
        return self._cache / f"{table.replace('/', '_')}_{digest}.csv.gz"
