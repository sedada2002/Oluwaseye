from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from quantflow.data.alpaca import AlpacaError, AlpacaPrices, bars_to_frame


class Resp:
    def __init__(self, status: int, payload: dict[str, Any] | None = None) -> None:
        self.status_code, self._p, self.text = status, payload or {}, ""

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    def json(self) -> dict[str, Any]:
        return self._p


class Session:
    def __init__(self, pages: list[Resp]) -> None:
        self.pages, self.calls, self.headers = pages, [], {}  # type: ignore[var-annotated]

    def get(self, url: str, params: dict[str, str], timeout: int) -> Resp:
        self.calls.append(dict(params))
        return self.pages.pop(0)


def bar(t: str, c: float) -> dict[str, Any]:
    return {"t": t, "o": c - 1, "h": c + 1, "l": c - 2, "c": c, "v": 1000}


def test_daily_timestamp_maps_to_new_york_date() -> None:
    df = bars_to_frame({"SPY": [bar("2024-03-11T04:00:00Z", 510.0), bar("2024-01-02T05:00:00Z", 470.0)]})
    assert list(df["date"]) == [pd.Timestamp("2024-03-11"), pd.Timestamp("2024-01-02")]


def test_pagination_symbol_mapping_and_cache(tmp_path: Path) -> None:
    s = Session([
        Resp(200, {"bars": {"BRK.B": [bar("2024-01-02T05:00:00Z", 360)]}, "next_page_token": "p2"}),
        Resp(200, {"bars": {"BRK.B": [bar("2024-01-03T05:00:00Z", 361)],
                            "SPY": [bar("2024-01-02T05:00:00Z", 470)]}, "next_page_token": None}),
    ])
    p = AlpacaPrices(key_id="k", secret="s", cache_dir=tmp_path, session=s)  # type: ignore[arg-type]
    df = p.prices(["BRK-B", "SPY"], "2024-01-01", "2024-01-31")
    assert s.calls[0]["symbols"] == "BRK.B,SPY"
    assert s.calls[0]["adjustment"] == "split"
    assert s.calls[1]["page_token"] == "p2"
    assert sorted(df["ticker"].unique()) == ["BRK-B", "SPY"]
    assert len(df[df["ticker"] == "BRK-B"]) == 2
    assert s.headers == {"APCA-API-KEY-ID": "k", "APCA-API-SECRET-KEY": "s"}
    p.prices(["BRK-B", "SPY"], "2024-01-01", "2024-01-31")   # served from cache
    assert len(s.calls) == 2


def test_start_clamped_to_2016(tmp_path: Path) -> None:
    s = Session([Resp(200, {"bars": {}, "next_page_token": None})])
    p = AlpacaPrices(key_id="k", secret="s", cache_dir=tmp_path, session=s)  # type: ignore[arg-type]
    p.prices(["SPY"], "2010-01-01", "2024-01-31")
    assert s.calls[0]["start"] == "2016-01-01"


def test_auth_error_is_actionable(tmp_path: Path) -> None:
    s = Session([Resp(403)])
    p = AlpacaPrices(key_id="k", secret="s", cache_dir=tmp_path, session=s)  # type: ignore[arg-type]
    with pytest.raises(AlpacaError, match="ALPACA_DATA_FEED=iex"):
        p.prices(["SPY"], "2024-01-01", "2024-01-31")


def test_missing_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APCA_API_KEY_ID", raising=False)
    monkeypatch.delenv("APCA_API_SECRET_KEY", raising=False)
    with pytest.raises(AlpacaError, match="APCA_API_KEY_ID"):
        AlpacaPrices(cache_dir=tmp_path)


def test_recent_end_is_pulled_back_15_minutes() -> None:
    from quantflow.data.alpaca import recent_safe_end

    now = pd.Timestamp("2026-11-05T22:13:00Z")
    assert recent_safe_end("2026-10-30", now) == "2026-10-30"           # history untouched
    assert recent_safe_end("2026-11-05", now) == "2026-11-05T21:57:00Z"  # today -> now - 16 min
    assert recent_safe_end("2026-11-06", now) == "2026-11-05T21:57:00Z"  # future -> now - 16 min
