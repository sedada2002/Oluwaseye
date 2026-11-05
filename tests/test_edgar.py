"""EDGAR parsing against companyfacts-shaped JSON with the quirks real filings have."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from quantflow.data.edgar import (
    NEGATIVE_EQUITY_DE,
    EdgarError,
    EdgarFundamentals,
    company_rows,
    debt_to_equity,
    sic_to_sector,
    ttm_revenue,
)


def fact(start: str | None, end: str, val: float, filed: str, form: str = "10-Q") -> dict[str, Any]:
    f: dict[str, Any] = {"end": end, "val": val, "filed": filed, "form": form, "accn": "x"}
    if start:
        f["start"] = start
    return f


def companyfacts() -> dict[str, Any]:
    """FY = calendar year. 2019 uses `Revenues`, 2020+ switches to the ASC 606 concept."""
    old = [
        fact("2019-01-01", "2019-03-31", 100, "2019-05-01"),
        fact("2019-04-01", "2019-06-30", 110, "2019-08-01"),
        fact("2019-01-01", "2019-06-30", 210, "2019-08-01"),            # 6-month YTD: ignored
        fact("2019-07-01", "2019-09-30", 120, "2019-11-01"),
        fact("2019-01-01", "2019-12-31", 460, "2020-02-20", "10-K"),    # Q4 not tagged -> 130
        fact("2018-01-01", "2018-12-31", 200, "2019-02-20", "10-K"),
        fact("2016-01-01", "2016-12-31", 150, "2017-02-20", "10-K"),
    ]
    new = [
        fact("2020-01-01", "2020-03-31", 150, "2020-05-01"),
        fact("2019-01-01", "2019-03-31", 999, "2020-05-01"),            # restated comparative
        fact("2020-04-01", "2020-06-30", 160, "2020-08-01"),
    ]
    liab = [fact(None, "2019-12-31", 50, "2020-02-20", "10-K"),
            fact(None, "2020-03-31", 60, "2020-05-01")]
    eq = [fact(None, "2019-12-31", 200, "2020-02-20", "10-K"),
          fact(None, "2020-03-31", -10, "2020-05-01")]
    return {"facts": {"us-gaap": {
        "Revenues": {"units": {"USD": old}},
        "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": new}},
        "Liabilities": {"units": {"USD": liab}},
        "StockholdersEquity": {"units": {"USD": eq}},
    }}}


def by_end(df: pd.DataFrame) -> dict[str, tuple[float, str]]:
    return {e.strftime("%Y-%m-%d"): (float(r), f.strftime("%Y-%m-%d"))
            for e, r, f in zip(df["end"], df["revenue"], df["filed"])}


def test_annual_is_ttm_at_year_end() -> None:
    t = by_end(ttm_revenue(companyfacts()))
    assert t["2019-12-31"] == (460.0, "2020-02-20")


def test_q4_derived_and_rolling_ttm_uses_original_numbers() -> None:
    t = by_end(ttm_revenue(companyfacts()))
    # TTM at Q1 2020 = Q2'19 110 + Q3'19 120 + derived Q4'19 130 + Q1'20 150 = 510.
    # The restated 999 for Q1'19 (filed later) must not leak in anywhere.
    assert t["2020-03-31"] == (510.0, "2020-05-01")
    assert t["2020-06-30"] == (120 + 130 + 150 + 160, "2020-08-01")
    assert all(v[0] < 999 for v in t.values())


def test_ttm_not_built_across_gaps() -> None:
    t = by_end(ttm_revenue(companyfacts()))
    # Only three 2019 quarters before Q4 is derived -> no TTM at Q3 2019
    assert "2019-09-30" not in t


def test_debt_to_equity_and_negative_equity() -> None:
    de = debt_to_equity(companyfacts()).set_index("end")["de"]
    assert de[pd.Timestamp("2019-12-31")] == pytest.approx(0.25)
    assert de[pd.Timestamp("2020-03-31")] == NEGATIVE_EQUITY_DE


def test_liabilities_derived_when_not_tagged() -> None:
    cf = companyfacts()
    gaap = cf["facts"]["us-gaap"]
    del gaap["Liabilities"]
    gaap["LiabilitiesAndStockholdersEquity"] = {"units": {"USD": [
        fact(None, "2019-12-31", 300, "2020-02-20", "10-K")]}}
    de = debt_to_equity(cf).set_index("end")["de"]
    assert de[pd.Timestamp("2019-12-31")] == pytest.approx(100 / 200)


def test_company_rows_datekey_is_latest_input_filing() -> None:
    rows = company_rows("ACME", companyfacts()).set_index("calendardate")
    r = rows.loc[pd.Timestamp("2019-12-31")]
    assert r["datekey"] == pd.Timestamp("2020-02-20")
    assert r["de"] == pytest.approx(0.25)
    # 2019 vs 2016 annuals -> the screen can compute a 3-year CAGR at FY2019
    assert pd.Timestamp("2016-12-31") in rows.index


def test_52_week_year_end_snaps_to_prior_quarter() -> None:
    cf = {"facts": {"us-gaap": {"Revenues": {"units": {"USD": [
        fact("2020-01-05", "2021-01-02", 500, "2021-02-25", "10-K")]}}}}}
    rows = company_rows("WK", cf)
    assert rows["calendardate"].iloc[0] == pd.Timestamp("2020-12-31")


def test_sic_mapping() -> None:
    assert sic_to_sector(7372) == "Technology"
    assert sic_to_sector(2834) == "Healthcare"
    assert sic_to_sector(6798) == "Real Estate"
    assert sic_to_sector(6022) == "Financial Services"
    assert sic_to_sector(None) == "Unknown"


# ---- network layer with a fake session --------------------------------------------------

class Resp:
    def __init__(self, status: int, payload: Any = None) -> None:
        self.status_code, self._p = status, payload

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    def json(self) -> Any:
        return self._p


class Session:
    def __init__(self, routes: dict[str, Resp]) -> None:
        self.routes, self.calls, self.headers = routes, [], {}  # type: ignore[var-annotated]

    def get(self, url: str, timeout: int) -> Resp:
        self.calls.append(url)
        for key, resp in self.routes.items():
            if key in url:
                return resp
        return Resp(404)


TICKERS = {"fields": ["cik", "name", "ticker", "exchange"], "data": [
    [1, "Acme", "ACME", "Nasdaq"],
    [1, "Acme class B", "ACMEB", "Nasdaq"],     # same company -> dropped
    [2, "OTC Co", "OTCX", "OTC"],               # not an exchange listing -> dropped
    [3, "Berk", "BRK.B", "NYSE"],
]}


def provider(tmp_path: Path, routes: dict[str, Resp]) -> tuple[EdgarFundamentals, Session]:
    s = Session(routes)
    p = EdgarFundamentals(user_agent="QuantFlow test you@example.com", cache_dir=tmp_path,
                          session=s, max_rps=1000)  # type: ignore[arg-type]
    return p, s


def test_user_agent_required(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    with pytest.raises(EdgarError, match="SEC_USER_AGENT"):
        EdgarFundamentals(cache_dir=tmp_path)


def test_universe_filters_and_dedupes(tmp_path: Path) -> None:
    p, s = provider(tmp_path, {"company_tickers_exchange": Resp(200, TICKERS)})
    assert sorted(p.universe()["ticker"]) == ["ACME", "BRK-B"]
    assert s.headers["User-Agent"].endswith("you@example.com")


def test_fundamentals_cache_parsed_rows(tmp_path: Path) -> None:
    routes = {"company_tickers_exchange": Resp(200, TICKERS),
              "CIK0000000001.json": Resp(200, companyfacts())}
    p, s = provider(tmp_path, routes)
    f1 = p.fundamentals()
    assert set(f1["ticker"]) == {"ACME"}            # BRK-B has no facts (404) -> skipped
    n = len(s.calls)
    p2, s2 = provider(tmp_path, {})                  # fresh instance, no network routes
    s2.routes = {"company_tickers_exchange": Resp(200, TICKERS)}
    f2 = p2.fundamentals()
    assert len(f2) == len(f1)
    assert not any("companyfacts" in c for c in s2.calls)
    assert n >= 2
    assert not list((tmp_path / "edgar" / "facts").glob("*.json"))   # raw JSON never stored


def test_sectors_from_submissions(tmp_path: Path) -> None:
    routes = {"company_tickers_exchange": Resp(200, TICKERS),
              "submissions/CIK0000000001.json": Resp(200, {"sic": "7372"})}
    p, _ = provider(tmp_path, routes)
    assert p.sectors(["ACME", "NOPE"]) == {"ACME": "Technology", "NOPE": "Unknown"}
    cached = json.loads((tmp_path / "edgar" / "submissions" / "1.json").read_text())
    assert cached["sic"] == "7372"
