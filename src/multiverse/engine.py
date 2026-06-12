"""Small engine-compatible implementation used by the orchestrator and tests.

This mirrors the PRD A API closely enough for Person B's loop to run while the
full engine can evolve behind the same surface.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .errors import DeadBranchError, IrreversibleInSpeculationError, UnknownBranchError, UnknownToolError
from .events import EventSink
from .types import EffectClass, ToolResult


ToolFn = Callable[..., Any]


@dataclass
class Branch:
    branch_id: str
    parent_branch_id: str | None
    workspace: Path
    db_path: Path
    alive: bool = True
    step_idx: int = 0
    staged_effects: list[dict[str, Any]] = field(default_factory=list)
    records: list[dict[str, Any]] = field(default_factory=list)


class Engine:
    def __init__(
        self,
        workspace: str | Path = ".multiverse/trunk",
        *,
        run_id: str = "run_dev",
        events_path: str | Path = "events.jsonl",
        state_dir: str | Path = ".multiverse",
    ) -> None:
        self.state_dir = Path(state_dir)
        self.trunk_workspace = Path(workspace)
        if not self.trunk_workspace.is_absolute():
            self.trunk_workspace = Path.cwd() / self.trunk_workspace
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.trunk_workspace.mkdir(parents=True, exist_ok=True)
        self.trunk_db_path = self.state_dir / "trunk.db"
        if not self.trunk_db_path.exists():
            sqlite3.connect(self.trunk_db_path).close()
        self.event_sink = EventSink(events_path, run_id=run_id)
        self._tools: dict[str, tuple[ToolFn, EffectClass]] = {}
        self._branches: dict[str, Branch] = {}
        self._children_count: dict[str, int] = {}
        self._lock = threading.RLock()
        self._branches["b_root"] = Branch("b_root", None, self.trunk_workspace, self.trunk_db_path)

    def register_tool(self, name: str, fn: ToolFn, effect_class: str | EffectClass) -> None:
        self._tools[name] = (fn, EffectClass(effect_class))

    def execute(self, branch_id: str, tool_name: str, args: dict[str, Any]) -> ToolResult:
        start = time.perf_counter()
        with self._lock:
            branch = self._require_branch(branch_id)
            if tool_name not in self._tools:
                raise UnknownToolError(tool_name)
            fn, effect_class = self._tools[tool_name]
            if effect_class is EffectClass.IRREVERSIBLE and branch_id != "b_root":
                branch.staged_effects.append({"tool": tool_name, "args": args})
                raise IrreversibleInSpeculationError(tool_name)

        try:
            value = fn(**args, _workspace=branch.workspace, _db_path=branch.db_path)
            result = ToolResult(ok=True, value=value, effect_class=effect_class)
        except Exception as exc:  # pragma: no cover - call-site behavior matters more than type
            result = ToolResult(ok=False, error=str(exc), effect_class=effect_class)

        latency_ms = (time.perf_counter() - start) * 1000
        result.latency_ms = latency_ms
        with self._lock:
            branch = self._require_branch(branch_id)
            branch.step_idx += 1
            record = {
                "branch_id": branch_id,
                "step_idx": branch.step_idx,
                "tool": tool_name,
                "args": args,
                "result": {"ok": result.ok, "value": result.value, "error": result.error},
                "wall_time": latency_ms,
            }
            branch.records.append(record)
            self._write_checkpoint(branch)
            self.event_sink.emit(
                "step",
                branch_id,
                parent_branch_id=branch.parent_branch_id,
                step_idx=branch.step_idx,
                payload={
                    "tool": tool_name,
                    "args_summary": _summarize(args),
                    "result_summary": _summarize(result.value if result.ok else result.error),
                    "effect_class": effect_class.value,
                    "latency_ms": latency_ms,
                },
            )
        return result

    def fork(self, parent_branch_id: str, n: int = 1, reason: str = "", entropy: float | None = None) -> list[str]:
        with self._lock:
            parent = self._require_branch(parent_branch_id)
            children: list[str] = []
            for _ in range(n):
                idx = self._children_count.get(parent_branch_id, 0) + 1
                self._children_count[parent_branch_id] = idx
                child_id = f"{parent_branch_id}.{idx}"
                child_workspace = self.state_dir / "branches" / child_id.replace(".", "_") / "workspace"
                child_db = self.state_dir / "branches" / child_id.replace(".", "_") / "branch.db"
                _copy_dir(parent.workspace, child_workspace)
                child_db.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(parent.db_path, child_db)
                child = Branch(child_id, parent_branch_id, child_workspace, child_db, records=list(parent.records))
                self._branches[child_id] = child
                children.append(child_id)
            self.event_sink.emit(
                "fork",
                parent_branch_id,
                parent_branch_id=parent.parent_branch_id,
                step_idx=parent.step_idx,
                payload={"children": children, "reason": reason, "entropy": entropy},
            )
            return children

    def squash(self, branch_id: str, cause: str, detail: str = "") -> None:
        with self._lock:
            branch = self._require_branch(branch_id, allow_dead=True)
            if branch.alive:
                branch.alive = False
                if branch.workspace != self.trunk_workspace:
                    shutil.rmtree(branch.workspace.parent, ignore_errors=True)
            self.event_sink.emit(
                "branch_died",
                branch_id,
                parent_branch_id=branch.parent_branch_id,
                step_idx=branch.step_idx,
                payload={"cause": cause, "detail": detail},
            )

    def commit(self, branch_id: str) -> None:
        with self._lock:
            branch = self._require_branch(branch_id)
            if branch_id != "b_root":
                _copy_dir(branch.workspace, self.trunk_workspace)
                shutil.copy2(branch.db_path, self.trunk_db_path)
            branch.alive = False
            self.event_sink.emit(
                "commit",
                branch_id,
                parent_branch_id=branch.parent_branch_id,
                step_idx=branch.step_idx,
                payload={"winning_branch": branch_id, "staged_effects_flushed": len(branch.staged_effects)},
            )

    def fork_at(self, branch_id: str, step_idx: int, n: int = 1) -> list[str]:
        # This lightweight implementation preserves the API and lineage. The full
        # replay engine can replace this without changing the orchestrator.
        with self._lock:
            branch = self._require_branch(branch_id, allow_dead=True)
            replay_id = f"{branch_id}.replay{step_idx}"
            replay_workspace = self.state_dir / "branches" / replay_id.replace(".", "_") / "workspace"
            replay_db = self.state_dir / "branches" / replay_id.replace(".", "_") / "branch.db"
            _copy_dir(branch.workspace if branch.workspace.exists() else self.trunk_workspace, replay_workspace)
            replay_db.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(branch.db_path if branch.db_path.exists() else self.trunk_db_path, replay_db)
            self._branches[replay_id] = Branch(
                replay_id,
                branch.parent_branch_id,
                replay_workspace,
                replay_db,
                step_idx=step_idx,
                records=branch.records[:step_idx],
            )
        return self.fork(replay_id, n=n, reason=f"fork_at:{branch_id}:{step_idx}")

    def get_workspace(self, branch_id: str) -> Path:
        return self._require_branch(branch_id, allow_dead=True).workspace

    def get_db_path(self, branch_id: str) -> Path:
        return self._require_branch(branch_id, allow_dead=True).db_path

    def get_step_idx(self, branch_id: str) -> int:
        return self._require_branch(branch_id, allow_dead=True).step_idx

    def _require_branch(self, branch_id: str, *, allow_dead: bool = False) -> Branch:
        try:
            branch = self._branches[branch_id]
        except KeyError as exc:
            raise UnknownBranchError(branch_id) from exc
        if not allow_dead and not branch.alive:
            raise DeadBranchError(branch_id)
        return branch

    def _write_checkpoint(self, branch: Branch) -> None:
        branch.workspace.mkdir(parents=True, exist_ok=True)
        checkpoint = branch.workspace / ".multiverse_messages.json"
        checkpoint.write_text(json.dumps(branch.records, indent=2, sort_keys=True), encoding="utf-8")


def _copy_dir(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def _summarize(value: Any, limit: int = 180) -> str:
    text = json.dumps(value, sort_keys=True, default=str) if not isinstance(value, str) else value
    return text if len(text) <= limit else text[: limit - 3] + "..."
