from __future__ import annotations

import json
from pathlib import Path

from multiverse.benchmark import make_orchestrator, trap_file_task, write_synthetic_fixture
from multiverse.engine import Engine
from multiverse.orchestrator import Action, Orchestrator, ProgrammaticVerifier, Task, _parse_actions, register_default_tools


def load_events(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_trap_task_single_path_fails_and_speculation_commits_winner(tmp_path: Path) -> None:
    single = make_orchestrator(tmp_path / "single", run_id="single")
    single_result = single.run("trap_file", speculation=False)
    assert single_result["winner"] is None
    single.engine.close()

    speculative = make_orchestrator(tmp_path / "spec", run_id="spec")
    spec_result = speculative.run("trap_file", speculation=True)
    assert spec_result["winner"] == "b_root.2"
    assert (speculative.engine.get_workspace("b_root") / "answer.txt").read_text(encoding="utf-8") == "SECOND"
    speculative.engine.close()

    events = load_events(tmp_path / "spec" / "events.jsonl")
    assert sum(event["event"] == "commit" for event in events) == 1
    fork = next(event for event in events if event["event"] == "fork")
    assert len(fork["payload"]["children"]) >= 2
    died = [event for event in events if event["event"] == "branch_died"]
    assert {event["branch_id"] for event in died} == {"b_root.1", "b_root.3"}


def test_fork_at_spawns_children_after_finished_run(tmp_path: Path) -> None:
    orchestrator = make_orchestrator(tmp_path, run_id="fork_at")
    result = orchestrator.run("trap_file", speculation=True)
    children = orchestrator.fork_at(result["winner"], 1, n=2)
    assert len(children) == 2
    assert children[0].startswith(f"{result['winner']}.")

    events = load_events(tmp_path / "events.jsonl")
    assert any(event["event"] == "fork" and event["payload"].get("reason") == "fork_at" for event in events)
    orchestrator.engine.close()


def test_all_branches_fail_retries_once_with_failure_memory(tmp_path: Path) -> None:
    def check(engine: Engine, branch_id: str, task: Task) -> tuple[bool, str, float]:
        answer = engine.get_workspace(branch_id) / "answer.txt"
        content = answer.read_text(encoding="utf-8").strip() if answer.exists() else ""
        return content == "WIN", f"got {content or 'missing'}", 1.0 if content == "WIN" else 0.0

    task = Task(
        task_id="retry_demo",
        title="Retry demo",
        prompt="Write WIN.",
        initial_actions=[Action("write_file", {"path": "answer.txt", "content": "LOSE"}, 0.4, "uncertain write")],
        alternatives=[
            [Action("write_file", {"path": "answer.txt", "content": "LOSE"}, 0.7, "bad branch")],
            [Action("write_file", {"path": "answer.txt", "content": "ALSO_LOSE"}, 0.7, "also bad branch")],
        ],
        failure_retry_alternatives=[
            [Action("write_file", {"path": "answer.txt", "content": "WIN"}, 0.95, "uses failure memory")]
        ],
        verifier=ProgrammaticVerifier(check).verify,
    )
    engine = Engine(root=tmp_path / "retry_eng", run_id="retry")
    register_default_tools(engine)
    orchestrator = Orchestrator(engine)
    orchestrator.register_task(task)

    result = orchestrator.run("retry_demo", speculation=True)
    assert result["winner"] is not None
    assert result["retry"] is True
    assert (engine.get_workspace("b_root") / "answer.txt").read_text(encoding="utf-8") == "WIN"

    events = load_events(tmp_path / "retry_eng" / "events.jsonl")
    forks = [event for event in events if event["event"] == "fork"]
    assert len(forks) == 2
    engine.close()


def test_synthetic_fixture_matches_event_contract(tmp_path: Path) -> None:
    path = write_synthetic_fixture(tmp_path / "fixture.jsonl")
    events = load_events(path)
    assert events[0]["event"] == "run_started"
    assert events[-1]["event"] == "run_finished"
    assert sum(event["event"] == "commit" for event in events) == 1
    for event in events:
        assert {"ts", "run_id", "event", "branch_id", "parent_branch_id", "step_idx", "payload"} <= set(event)


def test_parse_actions_accepts_single_action_object() -> None:
    actions = _parse_actions(
        '{"tool":"write_file","args":{"path":"ok.txt","content":"OK"},"confidence":0.91,"rationale":"direct"}'
    )
    assert actions == [Action("write_file", {"path": "ok.txt", "content": "OK"}, 0.91, "direct")]
