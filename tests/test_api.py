from fastapi.testclient import TestClient

from quantflow.api import app


def test_backtest_endpoint_synthetic() -> None:
    client = TestClient(app)
    r = client.post("/backtest", json={"synthetic": True, "start": "2016-01-01", "end": "2018-12-31"})
    assert r.status_code == 200
    body = r.json()
    assert body["synthetic"] is True
    assert {"sharpe", "max_drawdown", "cagr"} <= set(body["strategy"])
    assert "api_key" not in r.text.lower()


def test_backtest_without_key_returns_503(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("NASDAQ_DATA_LINK_API_KEY", raising=False)
    client = TestClient(app)
    r = client.post("/backtest", json={"synthetic": False})
    assert r.status_code == 503
