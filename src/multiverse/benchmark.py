"""Headless PRD B benchmark and demo tasks."""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import time
from pathlib import Path
from statistics import mean
from typing import Any

from .engine import Engine
from .events import EventSink
from .orchestrator import Action, Orchestrator, ProgrammaticVerifier, Task, register_default_tools


def build_tasks() -> dict[str, Task]:
    tasks = [
        trap_file_task(),
        sqlite_cleaning_task(),
        config_fix_task(),
        summary_task(),
        json_transform_task(),
        csv_task(),
    ]
    return {task.task_id: task for task in tasks}


def trap_file_task() -> Task:
    def check(engine: Engine, branch_id: str, task: Task) -> tuple[bool, str, float]:
        answer = engine.get_workspace(branch_id) / "answer.txt"
        if not answer.exists():
            return False, "answer.txt missing", 0.0
        content = answer.read_text(encoding="utf-8").strip()
        passed = content == "SECOND"
        return passed, f"expected SECOND, got {content!r}", 1.0 if passed else 0.0

    return Task(
        task_id="trap_file",
        title="Ambiguous file transform trap",
        prompt="Write answer.txt with the second all-caps token from 'first SECOND third'.",
        initial_actions=[Action("write_file", {"path": "answer.txt", "content": "FIRST"}, 0.42, "ambiguous ordinal")],
        alternatives=[
            [Action("write_file", {"path": "answer.txt", "content": "FIRST"}, 0.9, "first token interpretation")],
            [Action("write_file", {"path": "answer.txt", "content": "SECOND"}, 0.92, "second all-caps token interpretation")],
            [Action("write_file", {"path": "answer.txt", "content": "third"}, 0.7, "literal third token")],
        ],
        verifier=ProgrammaticVerifier(check).verify,
        failure_retry_alternatives=[
            [Action("write_file", {"path": "answer.txt", "content": "SECOND"}, 0.95, "failure memory excludes first token")]
        ],
    )


def sqlite_cleaning_task() -> Task:
    def check(engine: Engine, branch_id: str, task: Task) -> tuple[bool, str, float]:
        import sqlite3

        with sqlite3.connect(engine.get_db_path(branch_id)) as conn:
            rows = conn.execute("select count(*), sum(active) from users").fetchone()
        passed = rows == (3, 2)
        return passed, f"expected 3 rows and 2 active, got {rows}", 1.0 if passed else 0.2

    return Task(
        task_id="sqlite_cleaning",
        title="SQLite cleaning with duplicate trap",
        prompt="Create users table with unique emails; keep three users, two active.",
        initial_actions=[Action("sqlite_exec", {"sql": "create table users(email text, active int); insert into users values('a@x',1),('a@x',1),('b@x',1),('c@x',0);"}, 0.5, "dedupe ambiguity")],
        alternatives=[
            [Action("sqlite_exec", {"sql": "create table users(email text, active int); insert into users values('a@x',1),('a@x',1),('b@x',1),('c@x',0);"}, 0.8, "keeps duplicate")],
            [Action("sqlite_exec", {"sql": "create table users(email text primary key, active int); insert into users values('a@x',1),('b@x',1),('c@x',0);"}, 0.9, "dedupes by email")],
        ],
        verifier=ProgrammaticVerifier(check).verify,
    )


def config_fix_task() -> Task:
    def check(engine: Engine, branch_id: str, task: Task) -> tuple[bool, str, float]:
        cfg = engine.get_workspace(branch_id) / "app.conf"
        text = cfg.read_text(encoding="utf-8") if cfg.exists() else ""
        passed = "mode=production" in text and "debug=false" in text
        return passed, "config must set production mode and disable debug", 1.0 if passed else 0.1

    return Task(
        task_id="config_fix",
        title="Fix broken config",
        prompt="Create app.conf so the production checker would pass.",
        initial_actions=[Action("write_file", {"path": "app.conf", "content": "mode=prod\ndebug=true\n"}, 0.45, "prod abbreviation trap")],
        alternatives=[
            [Action("write_file", {"path": "app.conf", "content": "mode=prod\ndebug=false\n"}, 0.75, "partial fix")],
            [Action("write_file", {"path": "app.conf", "content": "mode=production\ndebug=false\n"}, 0.9, "literal expected keys")],
        ],
        verifier=ProgrammaticVerifier(check).verify,
    )


def summary_task() -> Task:
    def check(engine: Engine, branch_id: str, task: Task) -> tuple[bool, str, float]:
        text = (engine.get_workspace(branch_id) / "summary.txt").read_text(encoding="utf-8")
        passed = "verified source" in text.lower() and "misleading" not in text.lower()
        return passed, "summary should prefer verified source and omit misleading page", 1.0 if passed else 0.0

    return Task(
        task_id="summary",
        title="Misleading source summary",
        prompt="Summarize the verified source, not the misleading draft.",
        initial_actions=[Action("write_file", {"path": "summary.txt", "content": "Misleading draft says launch is Monday."}, 0.4, "source selection uncertainty")],
        alternatives=[
            [Action("write_file", {"path": "summary.txt", "content": "Misleading draft says launch is Monday."}, 0.8, "uses top page")],
            [Action("write_file", {"path": "summary.txt", "content": "Verified source says launch is Thursday."}, 0.9, "uses verified source")],
        ],
        verifier=ProgrammaticVerifier(check).verify,
    )


def json_transform_task() -> Task:
    def check(engine: Engine, branch_id: str, task: Task) -> tuple[bool, str, float]:
        data = json.loads((engine.get_workspace(branch_id) / "out.json").read_text(encoding="utf-8"))
        passed = data == {"count": 2, "items": ["alpha", "beta"]}
        return passed, f"unexpected json: {data}", 1.0 if passed else 0.0

    return Task(
        task_id="json_transform",
        title="JSON transform",
        prompt="Normalize to count plus sorted item names.",
        initial_actions=[Action("write_file", {"path": "out.json", "content": "{\"items\":[\"beta\",\"alpha\"]}"}, 0.5, "schema uncertainty")],
        alternatives=[
            [Action("write_file", {"path": "out.json", "content": "{\"count\":2,\"items\":[\"alpha\",\"beta\"]}"}, 0.9, "normalized schema")],
            [Action("write_file", {"path": "out.json", "content": "{\"items\":[\"alpha\",\"beta\"],\"total\":2}"}, 0.7, "wrong key")],
        ],
        verifier=ProgrammaticVerifier(check).verify,
    )


def csv_task() -> Task:
    def check(engine: Engine, branch_id: str, task: Task) -> tuple[bool, str, float]:
        text = (engine.get_workspace(branch_id) / "clean.csv").read_text(encoding="utf-8").strip()
        passed = text == "name,score\nAda,10\nLin,9"
        return passed, "CSV should keep header and sorted valid rows", 1.0 if passed else 0.0

    return Task(
        task_id="csv_clean",
        title="CSV clean and sort",
        prompt="Remove invalid rows and sort by score descending.",
        initial_actions=[Action("write_file", {"path": "clean.csv", "content": "Ada,10\nLin,9\nBad,n/a"}, 0.45, "header/invalid uncertainty")],
        alternatives=[
            [Action("write_file", {"path": "clean.csv", "content": "name,score\nAda,10\nLin,9"}, 0.9, "keeps header removes invalid")],
            [Action("write_file", {"path": "clean.csv", "content": "Ada,10\nLin,9"}, 0.7, "missing header")],
        ],
        verifier=ProgrammaticVerifier(check).verify,
    )


def make_orchestrator(base_dir: Path, run_id: str = "run_bench") -> Orchestrator:
    engine = Engine(workspace=base_dir / "trunk", state_dir=base_dir / "state", events_path=base_dir / "events.jsonl", run_id=run_id)
    register_default_tools(engine)
    orchestrator = Orchestrator(engine)
    for task in build_tasks().values():
        orchestrator.register_task(task)
    return orchestrator


def run_benchmark(iterations: int = 5) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for speculation in (False, True):
        for task_id in build_tasks():
            for idx in range(iterations):
                with tempfile.TemporaryDirectory(prefix="multiverse-bench-") as tmp:
                    orchestrator = make_orchestrator(Path(tmp), run_id=f"bench_{task_id}_{speculation}_{idx}")
                    started = time.perf_counter()
                    result = orchestrator.run(task_id, speculation=speculation)
                    elapsed = time.perf_counter() - started
                    rows.append({"task_id": task_id, "speculation": speculation, "success": bool(result["winner"]), "wall_clock": elapsed})
    return {
        "runs": rows,
        "summary": {
            "off_success_rate": mean(row["success"] for row in rows if not row["speculation"]),
            "on_success_rate": mean(row["success"] for row in rows if row["speculation"]),
            "off_wall_clock": mean(row["wall_clock"] for row in rows if not row["speculation"]),
            "on_wall_clock": mean(row["wall_clock"] for row in rows if row["speculation"]),
        },
    }


def write_synthetic_fixture(path: str | Path = "events.jsonl") -> Path:
    path = Path(path)
    if path.exists():
        path.unlink()
    sink = EventSink(path, run_id="run_fixture")
    sink.emit("run_started", "b_root", payload={"task_id": "fixture", "speculation": True})
    sink.emit("step", "b_root", step_idx=1, payload={"tool": "read_file", "args_summary": "task.md", "result_summary": "ok", "effect_class": "READ", "latency_ms": 4})
    sink.emit("fork", "b_root", step_idx=1, payload={"children": ["b_root.1", "b_root.2", "b_root.3"], "reason": "low confidence write", "entropy": 0.62})
    for branch, score, verdict in (("b_root.1", 0.1, "fail"), ("b_root.2", 1.0, "pass"), ("b_root.3", 0.4, "fail")):
        sink.emit("step", branch, parent_branch_id="b_root", step_idx=2, payload={"tool": "write_file", "args_summary": "answer", "result_summary": "ok", "effect_class": "SPECULATABLE_WRITE", "latency_ms": 9})
        sink.emit("verifier_score", branch, parent_branch_id="b_root", step_idx=2, payload={"branch_id": branch, "score": score, "verdict": verdict, "detail": "fixture score"})
    sink.emit("branch_died", "b_root.1", parent_branch_id="b_root", step_idx=2, payload={"cause": "verifier_rejected", "detail": "wrong output"})
    sink.emit("branch_died", "b_root.3", parent_branch_id="b_root", step_idx=2, payload={"cause": "verifier_rejected", "detail": "partial output"})
    sink.emit("commit", "b_root.2", parent_branch_id="b_root", step_idx=2, payload={"winning_branch": "b_root.2", "staged_effects_flushed": 0})
    sink.emit("run_finished", "b_root.2", parent_branch_id="b_root", step_idx=2, payload={"task_id": "fixture", "winner": "b_root.2", "success": True})
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--events-path", default="events.jsonl")
    parser.add_argument("--iterations", type=int, default=5)
    args = parser.parse_args()
    if args.fixture:
        print(write_synthetic_fixture(args.events_path))
        return
    print(json.dumps(run_benchmark(args.iterations), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

