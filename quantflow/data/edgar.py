"""Free point-in-time fundamentals from SEC EDGAR XBRL "companyfacts".

Every XBRL fact carries a `filed` date: the day the filing that contained it went
public. Facts are repeated in later filings as comparatives (sometimes restated), so
for each period we keep the EARLIEST filing - the number as originally reported.
That gives the same no-look-ahead guarantee as Sharadar's as-reported data, for free.

Revenue is built into trailing-twelve-month (TTM) values per fiscal quarter:
  - an annual (10-K) value is the TTM at fiscal year end
  - otherwise TTM = sum of the last four 3-month quarters
  - Q4 is rarely tagged on its own, so it's derived as annual minus Q1-Q3
D/E = total liabilities / stockholders' equity (as Sharadar defines `de`).

Limits you must know about:
  - The universe is today's listed companies (SEC's ticker file), so companies that
    were delisted are missing. That is survivorship bias; results will flatter the screen.
  - XBRL tagging is messy; some companies use unusual revenue concepts and get skipped.

SEC fair-access rules: a descriptive User-Agent with a contact address is required, and
no more than 10 requests per second. Set SEC_USER_AGENT in the backend .env.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd
import requests

from quantflow.data.base import FUNDAMENTAL_COLUMNS, UNIVERSE_COLUMNS, validate

TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
EXCHANGES = {"NYSE", "Nasdaq", "NYSE American", "NYSE Arca", "CBOE BZX"}

# Ordered by preference; companies switched concepts around the 2018 ASC 606 change
REVENUE_CONCEPTS = [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "SalesRevenueServicesNet",
]
EQUITY_CONCEPTS = [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
]
NEGATIVE_EQUITY_DE = 99.0       # negative/zero equity -> treat as maximally levered

QUARTER_DAYS = (80, 100)
ANNUAL_DAYS = (350, 380)


class EdgarError(RuntimeError):
    pass


# ---------------------------------------------------------------------------------------
# Pure parsing (no network) - this is what the tests exercise
# ---------------------------------------------------------------------------------------

def _usd_facts(facts: dict[str, Any], concepts: Iterable[str]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    gaap = facts.get("facts", {}).get("us-gaap", {})
    for rank, concept in enumerate(concepts):
        for f in gaap.get(concept, {}).get("units", {}).get("USD", []):
            if "filed" not in f or "end" not in f or "val" not in f:
                continue
            if not str(f.get("form", "")).startswith(("10-K", "10-Q", "20-F", "40-F")):
                continue
            rows.append({"start": f.get("start"), "end": f["end"], "val": float(f["val"]),
                         "filed": f["filed"], "rank": rank})
    df = pd.DataFrame(rows, columns=["start", "end", "val", "filed", "rank"])
    for col in ("start", "end", "filed"):
        df[col] = pd.to_datetime(df[col], errors="coerce")
    return df


def _earliest(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """One row per period: the first time it was filed (original, not restated)."""
    out: pd.DataFrame = (
        df.sort_values(["filed", "rank"]).drop_duplicates(keys, keep="first").reset_index(drop=True)
    )
    return out


def _snap_period_end(ts: pd.Series) -> pd.Series:
    """52/53-week fiscal years end on e.g. Jan 2 - pull those back to the prior month end
    so they land in the right calendar quarter."""
    early = ts.dt.day <= 7
    snapped: pd.Series = ts.where(~early, ts - pd.to_timedelta(ts.dt.day, unit="D"))
    return snapped


@dataclass(frozen=True)
class _Period:
    start: pd.Timestamp
    end: pd.Timestamp
    val: float
    filed: pd.Timestamp


def _periods(df: pd.DataFrame) -> list[_Period]:
    return [
        _Period(pd.Timestamp(s), pd.Timestamp(e), float(v), pd.Timestamp(f))
        for s, e, v, f in zip(df["start"], df["end"], df["val"], df["filed"])
    ]


def ttm_revenue(facts: dict[str, Any]) -> pd.DataFrame:
    """TTM revenue per fiscal period end: columns end, revenue, filed."""
    raw = _usd_facts(facts, REVENUE_CONCEPTS).dropna(subset=["start"])
    empty = pd.DataFrame(columns=["end", "revenue", "filed"])
    if raw.empty:
        return empty
    raw["days"] = (raw["end"] - raw["start"]).dt.days
    raw = _earliest(raw, ["start", "end"])

    qdf = raw[raw["days"].between(*QUARTER_DAYS)]
    qdf = qdf.sort_values(["end", "filed"]).drop_duplicates("end", keep="first")
    quarters = _periods(qdf)
    annuals = _periods(raw[raw["days"].between(*ANNUAL_DAYS)])

    # Derive Q4 = FY - (Q1+Q2+Q3) where Q4 wasn't tagged directly
    tol = pd.Timedelta(days=10)
    derived: list[_Period] = []
    for fy in annuals:
        if any(abs(q.end - fy.end) <= tol for q in quarters):
            continue
        inside = [q for q in quarters if q.start >= fy.start - tol and q.end < fy.end - tol]
        if len(inside) != 3:
            continue
        derived.append(_Period(
            start=max(q.end for q in inside) + pd.Timedelta(days=1),
            end=fy.end,
            val=fy.val - sum(q.val for q in inside),
            filed=max([fy.filed, *(q.filed for q in inside)]),
        ))
    quarters = sorted(quarters + derived, key=lambda q: q.end)

    rows: dict[pd.Timestamp, tuple[float, pd.Timestamp]] = {}
    for k in range(3, len(quarters)):
        window = quarters[k - 3 : k + 1]
        span = (window[-1].end - window[0].end).days
        if not 250 <= span <= 290:
            continue                                      # gap in the quarterly record
        rows[window[-1].end] = (sum(q.val for q in window), max(q.filed for q in window))
    for fy in annuals:                                    # a reported FY beats a derived sum
        rows[fy.end] = (fy.val, fy.filed)

    if not rows:
        return empty
    out = pd.DataFrame([(k, v[0], v[1]) for k, v in rows.items()], columns=["end", "revenue", "filed"])
    return out.sort_values("end").reset_index(drop=True)


def debt_to_equity(facts: dict[str, Any]) -> pd.DataFrame:
    """D/E per balance-sheet date: columns end, de, filed."""
    empty = pd.DataFrame(columns=["end", "de", "filed"])
    liab = _earliest(_usd_facts(facts, ["Liabilities"]), ["end"])
    eq = _earliest(_usd_facts(facts, EQUITY_CONCEPTS), ["end"])
    if eq.empty:
        return empty
    if liab.empty:
        tot = _earliest(_usd_facts(facts, ["LiabilitiesAndStockholdersEquity"]), ["end"])
        if tot.empty:
            return empty
        m = tot.merge(eq, on="end", suffixes=("_tot", "_eq"))
        m["liab"] = m["val_tot"] - m["val_eq"]
        m["filed"] = m[["filed_tot", "filed_eq"]].max(axis=1)
    else:
        m = liab.merge(eq, on="end", suffixes=("_l", "_eq"))
        m["liab"] = m["val_l"]
        m["filed"] = m[["filed_l", "filed_eq"]].max(axis=1)
    if m.empty:
        return empty
    m["de"] = np.where(m["val_eq"] > 0, m["liab"] / m["val_eq"], NEGATIVE_EQUITY_DE)
    out: pd.DataFrame = m[["end", "de", "filed"]].sort_values("end").reset_index(drop=True)
    return out


def company_rows(ticker: str, facts: dict[str, Any]) -> pd.DataFrame:
    """Rows in the provider's fundamentals schema for one company."""
    rev = ttm_revenue(facts)
    if rev.empty:
        return pd.DataFrame(columns=FUNDAMENTAL_COLUMNS)
    de = debt_to_equity(facts)
    m = rev.merge(de, on="end", how="left", suffixes=("_rev", "_de"))
    for col in ("end", "filed_rev", "filed_de"):
        m[col] = pd.to_datetime(m[col])
    m["de"] = pd.to_numeric(m["de"], errors="coerce")
    # A missing balance sheet leaves de NaN (fails the screen) but keeps the revenue row
    m["datekey"] = m[["filed_rev", "filed_de"]].max(axis=1, skipna=True)
    m["calendardate"] = _snap_period_end(m["end"])
    m["ticker"] = ticker
    return validate(m, FUNDAMENTAL_COLUMNS, "fundamentals")


def sic_to_sector(sic: int | None) -> str:
    """Rough SIC -> sector map (GICS-like buckets). Good enough for concentration checks."""
    if sic is None:
        return "Unknown"
    s = int(sic)
    rules: list[tuple[str, list[tuple[int, int]]]] = [
        ("Healthcare", [(2830, 2836), (3841, 3851), (8000, 8099)]),
        ("Technology", [(3570, 3579), (3600, 3699), (3820, 3829), (7370, 7379)]),
        ("Energy", [(1300, 1389), (2900, 2999), (4610, 4619)]),
        ("Utilities", [(4900, 4999)]),
        ("Real Estate", [(6500, 6553), (6798, 6798)]),
        ("Financial Services", [(6000, 6799)]),
        ("Communication Services", [(4800, 4899), (2700, 2799), (7810, 7819)]),
        ("Consumer Defensive", [(2000, 2199), (2840, 2844), (5400, 5499), (5900, 5912)]),
        ("Basic Materials", [(1000, 1499), (2600, 2699), (2800, 2829), (2850, 2899), (3300, 3399)]),
        ("Consumer Cyclical", [(2200, 2399), (2500, 2599), (3710, 3716), (3940, 3949),
                               (5000, 5999), (7000, 7369), (7380, 7999)]),
        ("Industrials", [(1500, 1799), (3400, 3569), (3580, 3599), (3700, 3799),
                         (3800, 3819), (3830, 3840), (4000, 4799), (8700, 8799)]),
    ]
    for name, ranges in rules:
        if any(lo <= s <= hi for lo, hi in ranges):
            return name
    return "Other"


# ---------------------------------------------------------------------------------------
# Network provider
# ---------------------------------------------------------------------------------------

class EdgarFundamentals:
    def __init__(
        self,
        user_agent: str | None = None,
        cache_dir: str | os.PathLike[str] | None = None,
        session: requests.Session | None = None,
        max_rps: float = 8.0,
        limit: int | None = None,
        facts_max_age_days: float | None = None,
    ) -> None:
        ua = user_agent or os.environ.get("SEC_USER_AGENT")
        if not ua or "@" not in ua:
            raise EdgarError(
                "SEC_USER_AGENT is not set. SEC requires a name and contact email, "
                'e.g. SEC_USER_AGENT="QuantFlow research you@example.com" in the backend .env.'
            )
        self._session = session or requests.Session()
        self._session.headers.update({"User-Agent": ua, "Accept-Encoding": "gzip, deflate"})
        base = Path(cache_dir or os.environ.get("QUANTFLOW_CACHE_DIR", ".cache")) / "edgar"
        self._cache = base
        (base / "facts").mkdir(parents=True, exist_ok=True)
        (base / "submissions").mkdir(parents=True, exist_ok=True)
        self._min_interval = 1.0 / max_rps
        self._last = 0.0
        self._limit = limit
        self._facts_max_age = facts_max_age_days   # None = keep forever (backtests)
        self._ciks: dict[str, int] | None = None

    # -- public --------------------------------------------------------------------------

    def universe(self) -> pd.DataFrame:
        tickers = self._ticker_map()
        df = pd.DataFrame({"ticker": list(tickers), "sector": "Unknown", "isdelisted": False})
        return validate(df, UNIVERSE_COLUMNS, "universe")

    def fundamentals(self) -> pd.DataFrame:
        frames: list[pd.DataFrame] = []
        for ticker, cik in self._ticker_map().items():
            # Cache the parsed rows, not the raw JSON (raw facts run to GBs across the market)
            parsed = self._cache / "facts" / f"{cik}.csv"
            fresh_enough = parsed.exists() and (
                self._facts_max_age is None
                or (time.time() - parsed.stat().st_mtime) / 86400 < self._facts_max_age)
            if fresh_enough:
                rows = pd.read_csv(parsed, parse_dates=["calendardate", "datekey"])
            else:
                facts = self._json(FACTS_URL.format(cik=cik), None)
                rows = company_rows(ticker, facts) if facts else pd.DataFrame(columns=FUNDAMENTAL_COLUMNS)
                rows.to_csv(parsed, index=False)
            if not rows.empty:
                frames.append(rows.assign(ticker=ticker))
        if not frames:
            raise EdgarError("No fundamentals parsed from EDGAR")
        return pd.concat(frames, ignore_index=True)

    def sectors(self, tickers: Sequence[str]) -> dict[str, str]:
        ciks = self._ticker_map()
        out: dict[str, str] = {}
        for t in tickers:
            cik = ciks.get(t)
            if cik is None:
                out[t] = "Unknown"
                continue
            sub = self._json(SUBMISSIONS_URL.format(cik=cik),
                             self._cache / "submissions" / f"{cik}.json")
            sic = sub.get("sic") if sub else None
            out[t] = sic_to_sector(int(sic) if sic not in (None, "") else None)
        return out

    # -- internals -----------------------------------------------------------------------

    def _ticker_map(self) -> dict[str, int]:
        if self._ciks is None:
            data = self._json(TICKERS_URL, self._cache / "company_tickers_exchange.json", max_age_days=7)
            if not data:
                raise EdgarError("Could not load SEC ticker list")
            fields = data["fields"]
            i_cik, i_tk, i_ex = fields.index("cik"), fields.index("ticker"), fields.index("exchange")
            seen: set[int] = set()
            mapping: dict[str, int] = {}
            for row in data["data"]:
                cik, tk, ex = int(row[i_cik]), str(row[i_tk]), row[i_ex]
                if ex not in EXCHANGES or cik in seen or "-" in tk:
                    continue                    # one ticker per company; skip preferreds/units
                seen.add(cik)
                mapping[tk.replace(".", "-")] = cik
            if self._limit:
                mapping = dict(list(mapping.items())[: self._limit])
            self._ciks = mapping
        return self._ciks

    def _json(self, url: str, cache_file: Path | None, max_age_days: float | None = None) -> dict[str, Any]:
        if cache_file is not None and cache_file.exists():
            age = (time.time() - cache_file.stat().st_mtime) / 86400
            if max_age_days is None or age < max_age_days:
                cached: dict[str, Any] = json.loads(cache_file.read_text())
                return cached
        for attempt in range(5):
            wait = self._min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            resp = self._session.get(url, timeout=60)
            if resp.status_code == 404:          # no XBRL facts for this company
                if cache_file is not None:
                    cache_file.write_text("{}")
                return {}
            if resp.status_code in (403, 429) or resp.status_code >= 500:
                time.sleep(2 ** attempt)
                continue
            if not resp.ok:
                raise EdgarError(f"SEC returned {resp.status_code} for {url}")
            data: dict[str, Any] = resp.json()
            if cache_file is not None:
                cache_file.write_text(json.dumps(data))
            return data
        raise EdgarError(f"SEC kept refusing {url} - check SEC_USER_AGENT and slow down")
