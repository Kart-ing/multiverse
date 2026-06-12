from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from multiverse.benchmark import make_orchestrator
from multiverse.live_ticker import ANSWER_FILE, TickerServer


def load_events(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_ticker_server_start_serve_bump_stop_standalone() -> None:
    with TickerServer(initial=41) as ticker:
        # serve a value
        with urllib.request.urlopen(ticker.url, timeout=2) as resp:
            assert json.loads(resp.read().decode("utf-8")) == {"value": 41}
        # programmatic control reflected in the next serve
        assert ticker.bump(6) == 47
        ticker.set_value(100)
        with urllib.request.urlopen(ticker.url, timeout=2) as resp:
            assert json.loads(resp.read().decode("utf-8")) == {"value": 100}
        assert ticker.serve_count == 2
    # stop() is clean: a fresh server can rebind and serve again
    with TickerServer(initial=7) as again:
        with urllib.request.urlopen(again.url, timeout=2) as resp:
            assert json.loads(resp.read().decode("utf-8")) == {"value": 7}


def test_request_count_bump_makes_post_fork_reads_fresh() -> None:
    # The "world moves" after the first served request, deterministically.
    with TickerServer(initial=41, bump_after_requests=1, bump_step=6) as ticker:
        with urllib.request.urlopen(ticker.url, timeout=2) as resp:  # pre-fork read
            assert json.loads(resp.read().decode("utf-8")) == {"value": 41}
        with urllib.request.urlopen(ticker.url, timeout=2) as resp:  # post-fork read
            assert json.loads(resp.read().decode("utf-8")) == {"value": 47}
        assert ticker.value == 47


def test_speculation_on_succeeds_stale_branches_die_winner_committed(tmp_path: Path) -> None:
    orchestrator = make_orchestrator(tmp_path / "on", run_id="ticker_on")
    result = orchestrator.run("live_ticker", speculation=True)

    # Branch C (fresh re-read) is the third alternative -> b_root.3 wins.
    assert result["winner"] == "b_root.3"
    current = orchestrator.ticker_server.value  # world moved to 47
    assert (orchestrator.engine.get_workspace("b_root") / ANSWER_FILE).read_text(encoding="utf-8") == str(current)
    orchestrator.ticker_server.stop()
    orchestrator.engine.close()

    events = load_events(tmp_path / "on" / "events.jsonl")
    assert sum(event["event"] == "commit" for event in events) == 1

    died = [event for event in events if event["event"] == "branch_died"]
    assert {event["branch_id"] for event in died} == {"b_root.1", "b_root.2"}
    # Both stale branches died with the UI-facing "stale data:" detail.
    for event in died:
        assert event["payload"]["detail"].startswith("stale data: had ")
        assert "world moved to" in event["payload"]["detail"]

    # The exact death-detail string the UI renders.
    assert all(
        event["payload"]["detail"] == f"stale data: had 41, world moved to {current}"
        for event in died
    )


def test_speculation_off_fails_verification(tmp_path: Path) -> None:
    orchestrator = make_orchestrator(tmp_path / "off", run_id="ticker_off")
    result = orchestrator.run("live_ticker", speculation=False)

    # Greedy single path reads once, writes the stale value, never re-checks.
    assert result["winner"] is None
    orchestrator.ticker_server.stop()
    orchestrator.engine.close()

    events = load_events(tmp_path / "off" / "events.jsonl")
    assert sum(event["event"] == "commit" for event in events) == 0
    score = next(event for event in events if event["event"] == "verifier_score")
    assert score["payload"]["verdict"] == "fail"
    assert score["payload"]["detail"].startswith("stale data: had 41, world moved to ")
