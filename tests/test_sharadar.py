from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from quantflow.data.sharadar import SharadarError, SharadarProvider


class FakeResp:
    def __init__(self, status: int, payload: dict[str, Any] | None = None) -> None:
        self.status_code = status
        self._payload = payload or {}

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    def json(self) -> dict[str, Any]:
        return self._payload


class FakeSession:
    def __init__(self, responses: list[FakeResp]) -> None:
        self.responses = responses
        self.calls: list[dict[str, str]] = []

    def get(self, url: str, params: dict[str, str], timeout: int) -> FakeResp:
        self.calls.append(dict(params))
        return self.responses.pop(0)


def _page(rows: list[list[Any]], cursor: str | None) -> FakeResp:
    cols = [{"name": n} for n in ["ticker", "calendardate", "datekey", "revenue", "de"]]
    return FakeResp(200, {"datatable": {"data": rows, "columns": cols},
                          "meta": {"next_cursor_id": cursor}})


def test_missing_key_is_a_clear_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("NASDAQ_DATA_LINK_API_KEY", raising=False)
    with pytest.raises(SharadarError, match="NASDAQ_DATA_LINK_API_KEY"):
        SharadarProvider(cache_dir=tmp_path)


def test_pagination_and_cache(tmp_path: Path) -> None:
    s = FakeSession([
        _page([["AAA", "2023-12-31", "2024-02-15", 1.0, 0.1]], "c1"),
        _page([["BBB", "2023-12-31", "2024-02-20", 2.0, 0.2]], None),
    ])
    p = SharadarProvider(api_key="k", cache_dir=tmp_path, session=s)  # type: ignore[arg-type]
    df = p.fundamentals()
    assert df["ticker"].tolist() == ["AAA", "BBB"]
    assert s.calls[1]["qopts.cursor_id"] == "c1"
    assert s.calls[0]["dimension"] == "ART"
    # Second call served from cache, no HTTP
    df2 = p.fundamentals()
    assert len(s.calls) == 2 and len(df2) == 2


def test_auth_error_never_leaks_key(tmp_path: Path) -> None:
    s = FakeSession([FakeResp(403)])
    p = SharadarProvider(api_key="SECRET123", cache_dir=tmp_path, session=s)  # type: ignore[arg-type]
    with pytest.raises(SharadarError) as e:
        p.fundamentals()
    assert "SECRET123" not in str(e.value)
    assert "subscription" in str(e.value)
