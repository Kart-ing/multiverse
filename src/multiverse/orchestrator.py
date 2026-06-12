"""PRD B orchestrator: agent loop, fork policy, scheduler, and commit flow."""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from .engine import Engine
from .events import EventSink
from .types import EffectClass, ToolResult


MAX_LIVE_BRANCHES = 3
MAX_FORK_DEPTH = 2
MAX_STEPS_PER_BRANCH = 25
BRANCH_TIMEOUT_SECONDS = 90
CONFIDENCE_THRESHOLD = 0.6


@dataclass(frozen=True)
class Action:
    tool: str
    args: dict[str, Any]
    confidence: float = 1.0
    rationale: str = ""


@dataclass
class BranchOutcome:
    branch_id: str
    actions: list[Action]
    results: list[ToolResult]
    error: str | None = None
    killed: bool = False


@dataclass
class Verification:
    score: float
    verdict: str
    detail: str


@dataclass
class Task:
    task_id: str
    title: str
    prompt: str
    initial_actions: list[Action]
    alternatives: list[list[Action]]
    verifier: Callable[[Engine, str, "Task"], Verification]
    failure_retry_alternatives: list[list[Action]] = field(default_factory=list)


class Runner(Protocol):
    def next_actions(self, task: Task, branch_id: str, failure_memory: str = "") -> list[Action]:
        ...

    def alternatives(self, task: Task, parent_action: Action, k: int, failure_memory: str = "") -> list[list[Action]]:
        ...


class ScriptedRunner:
    """Deterministic branch runner for benchmarks and demos."""

    def next_actions(self, task: Task, branch_id: str, failure_memory: str = "") -> list[Action]:
        if failure_memory and task.failure_retry_alternatives:
            return task.failure_retry_alternatives[0]
        return list(task.initial_actions)

    def alternatives(self, task: Task, parent_action: Action, k: int, failure_memory: str = "") -> list[list[Action]]:
        source = task.failure_retry_alternatives if failure_memory and task.failure_retry_alternatives else task.alternatives
        return [list(actions) for actions in source[:k]]


class AnthropicRunner:
    """Claude tool-action runner. Imported lazily so tests do not need the SDK."""

    def __init__(self, model: str = "claude-sonnet-4-6") -> None:
        try:
            from anthropic import Anthropic
        except ImportError as exc:  # pragma: no cover - depends on optional SDK
            raise RuntimeError("install anthropic to use AnthropicRunner") from exc
        self.client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        self.model = model

    def next_actions(self, task: Task, branch_id: str, failure_memory: str = "") -> list[Action]:
        prompt = _action_prompt(task, failure_memory)
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )
        return _parse_actions(response.content[0].text)

    def alternatives(self, task: Task, parent_action: Action, k: int, failure_memory: str = "") -> list[list[Action]]:
        prompt = (
            f"{_action_prompt(task, failure_memory)}\n\n"
            f"The current low-confidence action is: {json.dumps(parent_action.__dict__, sort_keys=True)}\n"
            f"Return the {k} most promising distinct next-action plans as JSON. "
            "They must be meaningfully different, not parameter tweaks."
        )
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1400,
            messages=[{"role": "user", "content": prompt}],
        )
        payload = json.loads(response.content[0].text)
        return [[Action(**item) for item in plan] for plan in payload["plans"][:k]]


class Critic:
    def consequential_and_uncertain(self, action: Action, effect_class: EffectClass | None) -> bool:
        if effect_class is not EffectClass.SPECULATABLE_WRITE:
            return False
        return action.confidence < CONFIDENCE_THRESHOLD


class ProgrammaticVerifier:
    def __init__(self, check: Callable[[Engine, str, Task], tuple[bool, str, float]]) -> None:
        self.check = check

    def verify(self, engine: Engine, branch_id: str, task: Task) -> Verification:
        passed, detail, score = self.check(engine, branch_id, task)
        return Verification(score=score, verdict="pass" if passed else "fail", detail=detail)


class LLMJudgeFallback:
    def verify(self, engine: Engine, branch_id: str, task: Task) -> Verification:
        workspace = engine.get_workspace(branch_id)
        files = sorted(str(path.relative_to(workspace)) for path in workspace.rglob("*") if path.is_file())
        detail = f"LLM judge fallback unavailable; produced files: {files}"
        return Verification(score=0.5 if files else 0.0, verdict="pass" if files else "fail", detail=detail)


class Orchestrator:
    def __init__(
        self,
        engine: Engine,
        runner: Runner | None = None,
        *,
        critic: Critic | None = None,
        max_live_branches: int = MAX_LIVE_BRANCHES,
        max_fork_depth: int = MAX_FORK_DEPTH,
        max_steps_per_branch: int = MAX_STEPS_PER_BRANCH,
        branch_timeout_seconds: int = BRANCH_TIMEOUT_SECONDS,
    ) -> None:
        self.engine = engine
        self.runner = runner or ScriptedRunner()
        self.critic = critic or Critic()
        self.max_live_branches = max_live_branches
        self.max_fork_depth = max_fork_depth
        self.max_steps_per_branch = max_steps_per_branch
        self.branch_timeout_seconds = branch_timeout_seconds
        self.tasks: dict[str, Task] = {}

    def register_task(self, task: Task) -> None:
        self.tasks[task.task_id] = task

    def run(self, task_id: str, *, speculation: bool = True, run_id: str | None = None) -> dict[str, Any]:
        task = self.tasks[task_id]
        run_id = run_id or f"run_{uuid.uuid4().hex[:8]}"
        self.engine.event_sink.run_id = run_id
        self.engine.event_sink.emit("run_started", "b_root", payload={"task_id": task_id, "speculation": speculation})
        failure_memory = ""
        try:
            result = self._attempt(task, speculation=speculation, failure_memory=failure_memory)
            if not result["winner"] and speculation:
                failure_memory = _failure_memory(result["verifications"])
                result = self._attempt(task, speculation=True, failure_memory=failure_memory)
                result["retry"] = True
            self.engine.event_sink.emit(
                "run_finished",
                result["winner"] or "b_root",
                payload={"task_id": task_id, "winner": result["winner"], "success": bool(result["winner"])},
            )
            return {"run_id": run_id, **result}
        except Exception as exc:
            self.engine.event_sink.emit("run_finished", "b_root", payload={"task_id": task_id, "success": False, "error": str(exc)})
            raise

    def fork_at(self, branch_id: str, step_idx: int, n: int = 2) -> list[str]:
        return self.engine.fork_at(branch_id, step_idx, n=n)

    def _attempt(self, task: Task, *, speculation: bool, failure_memory: str) -> dict[str, Any]:
        root_actions = self.runner.next_actions(task, "b_root", failure_memory=failure_memory)
        if speculation and failure_memory and task.failure_retry_alternatives:
            fork_idx = 0
        else:
            fork_idx = self._find_fork_index(root_actions) if speculation else None
        if fork_idx is None:
            outcome = self._run_branch("b_root", root_actions)
            verification = self._verify(task, outcome.branch_id)
            if verification.verdict == "pass":
                self.engine.commit(outcome.branch_id)
                return {"winner": outcome.branch_id, "outcomes": [outcome], "verifications": {outcome.branch_id: verification}}
            return {"winner": None, "outcomes": [outcome], "verifications": {outcome.branch_id: verification}}

        prefix = root_actions[:fork_idx]
        trigger = root_actions[fork_idx]
        prefix_outcome = self._run_branch("b_root", prefix)
        if prefix_outcome.error:
            return {"winner": None, "outcomes": [prefix_outcome], "verifications": {}}

        plans = self.runner.alternatives(task, trigger, self.max_live_branches, failure_memory=failure_memory)
        children = self.engine.fork("b_root", n=len(plans), reason=trigger.rationale or "low_confidence_action", entropy=1 - trigger.confidence)
        outcomes = self._race_children(children, plans)
        verifications = {outcome.branch_id: self._verify(task, outcome.branch_id) for outcome in outcomes if not outcome.killed}
        winner = self._pick_winner(verifications)
        if winner:
            self.engine.commit(winner)
            for outcome in outcomes:
                if outcome.branch_id != winner:
                    self.engine.squash(outcome.branch_id, "verifier_rejected", verifications.get(outcome.branch_id, Verification(0, "fail", "not verified")).detail)
        else:
            for outcome in outcomes:
                self.engine.squash(outcome.branch_id, "verifier_rejected", verifications.get(outcome.branch_id, Verification(0, "fail", "not verified")).detail)
        return {"winner": winner, "outcomes": outcomes, "verifications": verifications, "retry": bool(failure_memory)}

    def _run_branch(self, branch_id: str, actions: list[Action]) -> BranchOutcome:
        results: list[ToolResult] = []
        try:
            for idx, action in enumerate(actions):
                if idx >= self.max_steps_per_branch:
                    self.engine.squash(branch_id, "budget_killed", "max steps exceeded")
                    return BranchOutcome(branch_id, actions, results, killed=True)
                results.append(self.engine.execute(branch_id, action.tool, action.args))
            return BranchOutcome(branch_id, actions, results)
        except Exception as exc:
            return BranchOutcome(branch_id, actions, results, error=str(exc))

    def _race_children(self, children: list[str], plans: list[list[Action]]) -> list[BranchOutcome]:
        outcomes: list[BranchOutcome] = []
        with ThreadPoolExecutor(max_workers=min(self.max_live_branches, len(children))) as executor:
            futures = {executor.submit(self._run_branch, child, plan): child for child, plan in zip(children, plans)}
            deadline = time.monotonic() + self.branch_timeout_seconds
            for future in as_completed(futures, timeout=self.branch_timeout_seconds):
                child = futures[future]
                if time.monotonic() > deadline:
                    self.engine.squash(child, "budget_killed", "wall clock exceeded")
                    outcomes.append(BranchOutcome(child, [], [], killed=True))
                    continue
                outcomes.append(future.result())
        return outcomes

    def _find_fork_index(self, actions: list[Action]) -> int | None:
        for idx, action in enumerate(actions):
            effect_class = self.engine._tools.get(action.tool, (None, None))[1]  # Shared API has no inspect method yet.
            if action.confidence < CONFIDENCE_THRESHOLD and self.critic.consequential_and_uncertain(action, effect_class):
                return idx
        return None

    def _verify(self, task: Task, branch_id: str) -> Verification:
        verification = task.verifier(self.engine, branch_id, task)
        self.engine.event_sink.emit(
            "verifier_score",
            branch_id,
            step_idx=self.engine.get_step_idx(branch_id),
            payload={"branch_id": branch_id, "score": verification.score, "verdict": verification.verdict, "detail": verification.detail},
        )
        return verification

    @staticmethod
    def _pick_winner(verifications: dict[str, Verification]) -> str | None:
        passing = [(branch_id, result) for branch_id, result in verifications.items() if result.verdict == "pass"]
        if not passing:
            return None
        return max(passing, key=lambda item: item[1].score)[0]


def register_default_tools(engine: Engine) -> None:
    def write_file(path: str, content: str, _workspace: Path, _db_path: Path) -> dict[str, str]:
        target = _safe_workspace_file(_workspace, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"path": path, "bytes": str(len(content))}

    def replace_text(path: str, old: str, new: str, _workspace: Path, _db_path: Path) -> dict[str, str]:
        target = _safe_workspace_file(_workspace, path)
        content = target.read_text(encoding="utf-8")
        target.write_text(content.replace(old, new), encoding="utf-8")
        return {"path": path}

    def sqlite_exec(sql: str, _workspace: Path, _db_path: Path) -> str:
        with sqlite3_connect(str(_db_path)) as conn:
            conn.executescript(sql)
            conn.commit()
        return "ok"

    engine.register_tool("write_file", write_file, EffectClass.SPECULATABLE_WRITE)
    engine.register_tool("replace_text", replace_text, EffectClass.SPECULATABLE_WRITE)
    engine.register_tool("sqlite_exec", sqlite_exec, EffectClass.SPECULATABLE_WRITE)


def _safe_workspace_file(workspace: Path, path: str) -> Path:
    target = (workspace / path).resolve()
    if not str(target).startswith(str(workspace.resolve())):
        raise ValueError(f"path escapes workspace: {path}")
    return target


def sqlite3_connect(db_path: str):
    import sqlite3

    return sqlite3.connect(db_path)


def _action_prompt(task: Task, failure_memory: str) -> str:
    return (
        f"Task: {task.title}\n\n{task.prompt}\n\n"
        "Return only JSON in this exact shape: "
        '{"actions":[{"tool":"write_file","args":{"path":"answer.txt","content":"..."},"confidence":0.8,"rationale":"..."}]}. '
        "Every action must include confidence from 0 to 1. Do not include markdown.\n"
        f"Failure memory: {failure_memory or 'none'}"
    )


def _parse_actions(text: str) -> list[Action]:
    payload = json.loads(_extract_json(text))
    if isinstance(payload, dict) and "actions" in payload:
        actions = payload["actions"]
    elif isinstance(payload, dict) and {"tool", "args"} <= set(payload):
        actions = [payload]
    else:
        actions = payload
    return [Action(**action) for action in actions]


def _extract_json(text: str) -> str:
    match = re.search(r"```json\s*(.*?)```", text, flags=re.S)
    return match.group(1) if match else text


def _failure_memory(verifications: dict[str, Verification]) -> str:
    return "; ".join(f"{branch_id} failed because {verification.detail}" for branch_id, verification in verifications.items())
