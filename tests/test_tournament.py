import json
from pathlib import Path

from quantflow.data.fixtures import SyntheticProvider
from quantflow.metrics import Performance
from quantflow.tournament import Score, Window, eligible, pick_winner, tournament


def perf(sharpe: float, mdd: float) -> Performance:
    return Performance(0.0, 0.0, 0.0, sharpe, 0.0, mdd, 0, 0.0)


def test_rule_requires_beating_spy_and_tolerable_drawdown() -> None:
    spy = perf(0.8, -0.34)
    assert eligible(perf(0.9, -0.40), spy)
    assert not eligible(perf(0.9, -0.50), spy)      # >10 points worse drawdown
    assert not eligible(perf(0.7, -0.10), spy)      # lower Sharpe


def test_winner_defaults_to_spy_when_nothing_qualifies() -> None:
    spy = perf(0.8, -0.34)
    scores = [Score("a", "A", "sel", perf(0.5, -0.2), 1), Score("b", "B", "sel", perf(1.2, -0.6), 1)]
    assert pick_winner(scores, spy) == "spy"
    scores.append(Score("c", "C", "sel", perf(1.0, -0.3), 1))
    assert pick_winner(scores, spy) == "c"


def test_tournament_writes_verdict(tmp_path: Path) -> None:
    res = tournament(SyntheticProvider(), tmp_path, "synthetic",
                     Window("selection", "2014-01-01", "2018-12-31"),
                     Window("holdout", "2019-01-02", "2022-12-30"))
    data = json.loads((tmp_path / "tournament.json").read_text())
    assert data["adopted"] == res["adopted"]
    assert "Verdict" in (tmp_path / "tournament.md").read_text()
    assert (tmp_path / "holdout_momentum.html").exists()
