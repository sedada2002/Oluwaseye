"""Guardrails. They can stop the desk from opening, and they can force a flatten."""
import os

from .config import Risk


class Guardrails:
    def __init__(self, risk: Risk, kill_file: str | None, start_equity: float):
        self.risk = risk
        self.kill_file = kill_file
        self.start_equity = start_equity

    def kill_on(self) -> bool:
        """Create the kill file to halt. Flattens any open position on the next step."""
        return bool(self.kill_file) and os.path.exists(self.kill_file)

    def check_open(self, broker, ticket_usd: float) -> tuple[bool, str | None]:
        if self.kill_on():
            return False, "kill_switch"
        if broker.position is not None:
            return False, "position_open"
        if ticket_usd > broker.cash:
            return False, "insufficient_cash"
        if broker.equity() - self.start_equity <= -self.risk.session_loss_limit_usd:
            return False, "session_loss_limit"
        return True, None
