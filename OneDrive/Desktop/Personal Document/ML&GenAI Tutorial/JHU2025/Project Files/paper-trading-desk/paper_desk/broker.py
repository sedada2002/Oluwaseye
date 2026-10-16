"""Simulated broker. Paper money only. Fills, fees and slippage are modelled, not real.

Cash accounting: cash leaves the account at the full ticket size on entry. The entry fee
comes out of that ticket, so units = (ticket - fee) / fill price.
"""
from dataclasses import dataclass, field

from .config import Costs, Risk


@dataclass
class Position:
    tid: str
    ticker: str
    chain: str
    entry_price: float
    units: float
    ticket_usd: float
    entry_fee: float
    opened_at: float
    last_price: float
    last_liquidity: float
    missing_marks: int = 0


@dataclass
class PaperBroker:
    costs: Costs
    risk: Risk
    cash: float
    position: Position | None = None
    trades: list = field(default_factory=list)

    def __post_init__(self):
        self.start_cash = self.cash

    def fee(self, usd: float) -> float:
        return max(self.costs.fee_rate * usd, self.costs.fee_floor_usd)

    def _impact(self, usd: float, liquidity_usd: float) -> float:
        return self.costs.slippage_per_liquidity * (usd / liquidity_usd)

    def open(self, tid, ticker, chain, price, liquidity_usd, ticket_usd, t) -> Position:
        if self.position is not None:
            raise RuntimeError("already holding a position")
        if price is None or price <= 0 or liquidity_usd is None or liquidity_usd <= 0:
            raise ValueError("cannot open without a valid price and liquidity")
        if ticket_usd > self.cash:
            raise ValueError("ticket exceeds free cash")
        fill = price * (1 + self._impact(ticket_usd, liquidity_usd))
        fee = self.fee(ticket_usd)
        units = (ticket_usd - fee) / fill
        if units <= 0:
            raise ValueError("ticket does not cover its own fee")
        self.cash -= ticket_usd
        self.position = Position(tid=tid, ticker=ticker, chain=chain, entry_price=fill,
                                 units=units, ticket_usd=ticket_usd, entry_fee=fee,
                                 opened_at=t, last_price=fill, last_liquidity=liquidity_usd)
        return self.position

    def mark(self, t, price=None, liquidity_usd=None, volume_h6=None, volume_h24=None):
        """Update the position with a new observation. Returns an exit reason or None."""
        p = self.position
        if p is None:
            raise RuntimeError("no open position to mark")
        if liquidity_usd:
            p.last_liquidity = liquidity_usd
        if price is None or price <= 0:
            p.missing_marks += 1
            if p.missing_marks >= self.risk.max_missing_marks:
                return "missing_data"  # a position you cannot measure is not held
            return None
        p.missing_marks = 0
        p.last_price = price

        ret = price / p.entry_price - 1
        if ret <= self.risk.stop_loss:
            return "stop_loss"
        if ret >= self.risk.take_profit:
            return "take_profit"
        if t - p.opened_at >= self.risk.max_hold_minutes:
            return "time_stop"
        if volume_h6 is not None and volume_h24:
            avg6 = volume_h24 / 4
            if avg6 > 0 and volume_h6 / avg6 < self.risk.volume_ratio_exit:
                return "volume_dried"
        return None

    def close(self, t, reason: str) -> dict:
        p = self.position
        if p is None:
            raise RuntimeError("no open position to close")
        gross_mark = p.units * p.last_price
        fill = p.last_price * (1 - self._impact(gross_mark, p.last_liquidity))
        gross = p.units * fill
        net = gross - self.fee(gross)
        self.cash += net
        trade = {"tid": p.tid, "ticker": p.ticker, "chain": p.chain, "reason": reason,
                 "entry_price": p.entry_price, "exit_price": fill,
                 "ticket_usd": p.ticket_usd, "pnl_usd": round(net - p.ticket_usd, 4),
                 "held_minutes": round(t - p.opened_at, 2)}
        self.trades.append(trade)
        self.position = None
        return trade

    def equity(self) -> float:
        held = self.position.units * self.position.last_price if self.position else 0.0
        return self.cash + held
