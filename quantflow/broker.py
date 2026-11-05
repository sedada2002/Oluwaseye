"""Read-only view of an Alpaca account: equity, cash, open positions, and when each
position was opened (rebuilt from fill history). This module never places orders.

Defaults to the PAPER endpoint. Set APCA_API_BASE_URL only if you deliberately want to
read a live account; nothing here can trade either way.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import pandas as pd
import requests

PAPER_URL = "https://paper-api.alpaca.markets"


class BrokerError(RuntimeError):
    pass


@dataclass
class Holding:
    ticker: str
    qty: int
    entry_date: pd.Timestamp | None     # None if the opening fill is older than the history
    entry_price: float
    initial_qty: int                    # largest size of the current lot (partial exits shrink qty)

    @property
    def partial_taken(self) -> bool:
        return self.qty < self.initial_qty


@dataclass
class Account:
    equity: float
    cash: float
    holdings: list[Holding]
    source: str


def lots_from_fills(fills: list[dict[str, Any]]) -> dict[str, tuple[pd.Timestamp, int]]:
    """Replay fills oldest-first. For each symbol still open, return (entry date of the
    current lot, largest qty reached in that lot)."""
    state: dict[str, tuple[int, pd.Timestamp | None, int]] = {}
    for f in sorted(fills, key=lambda x: str(x["transaction_time"])):
        sym = str(f["symbol"]).replace(".", "-")
        qty = int(float(f["qty"]))
        side = str(f["side"])
        held, start, peak = state.get(sym, (0, None, 0))
        if side == "buy":
            if held <= 0:
                start, peak = pd.Timestamp(str(f["transaction_time"])[:10]), 0
            held += qty
            peak = max(peak, held)
        else:
            held -= qty
        if held <= 0:
            held, start, peak = 0, None, 0
        state[sym] = (held, start, peak)
    return {s: (start, peak) for s, (held, start, peak) in state.items() if held > 0 and start is not None}


class AlpacaAccount:
    def __init__(self, key_id: str | None = None, secret: str | None = None,
                 base_url: str | None = None, session: requests.Session | None = None) -> None:
        kid = key_id or os.environ.get("APCA_API_KEY_ID")
        sec = secret or os.environ.get("APCA_API_SECRET_KEY")
        if not kid or not sec:
            raise BrokerError("APCA_API_KEY_ID / APCA_API_SECRET_KEY are not set")
        self._base = (base_url or os.environ.get("APCA_API_BASE_URL", PAPER_URL)).rstrip("/")
        self._s = session or requests.Session()
        self._s.headers.update({"APCA-API-KEY-ID": kid, "APCA-API-SECRET-KEY": sec})

    @property
    def is_paper(self) -> bool:
        return "paper" in self._base

    def _get(self, path: str, params: dict[str, str] | None = None) -> Any:
        r = self._s.get(f"{self._base}{path}", params=params or {}, timeout=30)
        if r.status_code in (401, 403):
            raise BrokerError(f"Alpaca account API refused the request ({r.status_code}); check the keys")
        if not r.ok:
            raise BrokerError(f"Alpaca account API error {r.status_code}")
        return r.json()

    def snapshot(self) -> Account:
        acct = self._get("/v2/account")
        positions = self._get("/v2/positions")
        fills: list[dict[str, Any]] = []
        token: str | None = None
        while True:
            params = {"direction": "asc", "page_size": "100"}
            if token:
                params["page_token"] = token
            page = self._get("/v2/account/activities/FILL", params)
            if not page:
                break
            fills.extend(page)
            if len(page) < 100:
                break
            token = str(page[-1]["id"])
        lots = lots_from_fills(fills)
        holdings = []
        for p in positions:
            if str(p.get("side", "long")) != "long":
                continue
            sym = str(p["symbol"]).replace(".", "-")
            qty = int(float(p["qty"]))
            start, peak = lots.get(sym, (None, qty))
            holdings.append(Holding(sym, qty, start, float(p["avg_entry_price"]), max(peak, qty)))
        return Account(float(acct["equity"]), float(acct["cash"]), holdings,
                       "Alpaca paper account" if self.is_paper else "Alpaca LIVE account (read-only)")


def load_positions_file(path: Path, equity: float | None, cash: float | None) -> Account:
    """positions.json: {"equity": 100000, "cash": 40000, "holdings": [
        {"ticker": "NVDA", "qty": 20, "entry_date": "2026-09-01", "entry_price": 120.5, "initial_qty": 40}]}"""
    data = json.loads(path.read_text())
    holdings = [Holding(str(h["ticker"]), int(h["qty"]),
                        pd.Timestamp(h["entry_date"]) if h.get("entry_date") else None,
                        float(h["entry_price"]), int(h.get("initial_qty", h["qty"])))
                for h in data.get("holdings", [])]
    eq = equity if equity is not None else float(data.get("equity", 100_000.0))
    c = cash if cash is not None else float(data.get("cash", eq))
    return Account(eq, c, holdings, f"positions file {path.name}")


def holdings_json(account: Account) -> list[dict[str, Any]]:
    return [{**asdict(h), "entry_date": h.entry_date.strftime("%Y-%m-%d") if h.entry_date is not None else None}
            for h in account.holdings]
