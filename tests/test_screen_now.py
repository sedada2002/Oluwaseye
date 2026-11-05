from pathlib import Path

import pandas as pd

from quantflow.data.fixtures import SyntheticProvider
from quantflow.screen import run_screen
from quantflow.config import ScreenConfig
from quantflow.screen_now import main, screen_today
from quantflow.strategies import GrowthMomentumStrategy, by_name


def test_combined_strategy_is_intersection() -> None:
    sp = SyntheticProvider()
    fund = sp.fundamentals()
    px = sp.prices(sp.universe()["ticker"].tolist() + ["SPY"], "2022-01-01", "2024-05-31")
    closes = px.pivot_table(index="date", columns="ticker", values="close")
    day = pd.Timestamp("2024-05-31")
    s = GrowthMomentumStrategy()
    both = set(s.select(fund, closes.drop(columns=["SPY"]), closes["SPY"], day)["ticker"])
    g = set(s.growth.select(fund, closes.drop(columns=["SPY"]), closes["SPY"], day)["ticker"])
    m = set(s.momentum.select(fund, closes.drop(columns=["SPY"]), closes["SPY"], day)["ticker"])
    assert both == g & m
    assert by_name("growth_momentum").name == "growth_momentum"


def test_screen_handles_no_history() -> None:
    sp = SyntheticProvider()
    px = sp.prices(["T001", "SPY"], "2024-05-01", "2024-05-31")
    closes = px.pivot_table(index="date", columns="ticker", values="close")
    out = run_screen(sp.fundamentals(), closes[["T001"]], closes["SPY"], pd.Timestamp("2024-05-31"), ScreenConfig())
    assert out.empty


def test_screen_today_rows_obey_risk_rules() -> None:
    day, df = screen_today(SyntheticProvider(), "growth_momentum", 100_000, asof="2024-05-31")
    assert day == pd.Timestamp("2024-05-31")
    for r in df.to_dict(orient="records"):
        assert r["example_cost"] <= 10_000 + 1e-6
        assert r["example_shares"] * (r["close"] - r["stop"]) <= 1_000 + 1e-6


def test_cli_writes_outputs(tmp_path: Path) -> None:
    assert main(["--source", "synthetic", "--asof", "2024-05-31", "--out-dir", str(tmp_path)]) == 0
    md = (tmp_path / "screen.md").read_text()
    assert "not investment advice" in md
    assert (tmp_path / "screen.csv").exists()
