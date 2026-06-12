"""Engine — tool-call proxy, speculative execution harness, and record/replay.

Every agent tool call routes through Engine.execute(). The engine intercepts
effects, isolates them per-branch sandbox, gates irreversible actions, and
provides fork / commit / replay / fork_at for speculative execution.

CRITICAL: Tools MUST confine effects to ctx.workspace and ctx.db_path.
All outbound HTTP MUST go through ctx.http — direct urllib/requests/httpx
bypasses effect gating and breaks speculation guarantees.
"""

from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .errors import (
    DeadBranchError,
    IrreversibleInSpeculationError,
    UnknownBranchError,
    UnknownToolError,
)
from .events import EventBus
from .journal import Journal
from .state import BranchManager
from .types import EffectClass, ToolResult

_VALID_SQUASH_CAUSES = frozenset({"verifier_rejected", "error", "budget_killed"})


@dataclass
class ToolContext:
    """Sandboxed execution context.  Tools MUST restrict all effects to
    ``workspace`` and ``db_path``; outbound HTTP MUST use the ``http`` proxy."""
    branch_id: str
    workspace: Path
    db_path: Path
    http: "Engine.HttpProxy"


class Engine:
    """Speculation harness — intercepts tools, isolates branches, commits one winner.

    >>> engine = Engine(root=".multiverse", seed_workspace=...)
    >>> engine.register_tool("read", my_read, EffectClass.READ)
    >>> engine.register_tool("write", my_write, EffectClass.SPECULATABLE_WRITE)
    >>> engine.execute("b_root", "read", {"path": "x.txt"})
    >>> kids = engine.fork("b_root", n=3)
    >>> engine.commit("b_root.2")
    >>> engine.replay("b_root.2", until_step=5)
    """

    # -- HttpProxy (inner class) -------------------------------------------

    class HttpProxy:
        """Per-branch HTTP proxy.  Speculative branches stage side-effecting
        requests (except GET to allowlisted hosts).  Replay mode always stages.
        On commit staged requests are flushed for real."""

        __slots__ = ("_engine", "_branch_id", "_staging_path", "_mode")

        def __init__(
            self, engine: "Engine", branch_id: str, staging_path: Path, mode: str
        ) -> None:
            self._engine = engine
            self._branch_id = branch_id
            self._staging_path = staging_path
            self._mode = mode  # "live" | "replay"

        def request(
            self,
            method: str,
            url: str,
            headers: dict[str, str] | None = None,
            body: str | None = None,
        ) -> dict[str, Any]:
            """Issue or stage an HTTP request.

            Returns staged ``{"staged": True, "method": ..., "url": ...}`` or
            performed ``{"staged": False, "status": int, "body": str}`` (body
            capped at 10 000 chars).
            """
            hostname = urllib.parse.urlparse(url).hostname or ""
            if self._mode == "replay":
                should_stage = True
            else:
                speculative = self._engine._mgr.is_speculative(self._branch_id)
                safe_get = method == "GET" and hostname in self._engine._http_get_allowlist
                should_stage = speculative and not safe_get

            if should_stage:
                record = {"ts": time.time(), "method": method, "url": url,
                          "headers": headers, "body": body}
                self._staging_path.parent.mkdir(parents=True, exist_ok=True)
                with open(self._staging_path, "a") as fh:
                    fh.write(json.dumps(record, default=str) + "\n")
                return {"staged": True, "method": method, "url": url}

            data = body.encode("utf-8") if isinstance(body, str) else None
            req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    text = resp.read().decode("utf-8", errors="replace")
                    return {"staged": False, "status": resp.status, "body": text[:10000]}
            except Exception as exc:
                return {"staged": False, "status": 0, "body": str(exc)[:10000]}

    # -- Engine public API -------------------------------------------------

    def __init__(
        self,
        root: str | Path = ".multiverse",
        run_id: str | None = None,
        ingest_url: str | None = None,
        clickhouse: dict | None = None,
        http_get_allowlist: list[str] | None = None,
        seed_workspace: str | Path | None = None,
        run_started_payload: dict | None = None,
    ) -> None:
        """Bootstrap the engine.  Creates root layout, BranchManager, Journal,
        EventBus.  If *seed_workspace* is given copies its contents into trunk
        workspace before the initial snapshot."""
        self._root = Path(root).resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        self._run_id = run_id or "run_" + uuid.uuid4().hex[:8]
        self._http_get_allowlist: list[str] = http_get_allowlist or []
        self._tools: dict[str, tuple[Callable[..., Any], EffectClass]] = {}
        # branch_id -> (parent_branch_id, parent_step_at_fork_time)
        self._fork_points: dict[str, tuple[str | None, int | None]] = {}
        self._commit_lock = threading.Lock()

        self._mgr = BranchManager(self._root)
        self._journal = Journal(self._root / "journal.jsonl")
        self._events = EventBus(self._root / "events.jsonl", ingest_url, clickhouse)

        if seed_workspace is not None:
            seed = Path(seed_workspace)
            trunk_ws = self._mgr.get_workspace(BranchManager.TRUNK_ID)
            if seed.is_dir():
                for child in seed.iterdir():
                    dest = trunk_ws / child.name
                    if child.is_dir():
                        shutil.copytree(child, dest)
                    else:
                        shutil.copy2(child, dest)

        self._mgr.snapshot_trunk_initial()
        self._events.emit("run_started", run_id=self._run_id,
                          branch_id=BranchManager.TRUNK_ID, parent_branch_id=None,
                          step_idx=0, payload=run_started_payload or {})

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _json_safe(obj: Any) -> Any:
        """*obj* if JSON-serializable, else its ``repr()``."""
        try:
            json.dumps(obj)
            return obj
        except (TypeError, ValueError):
            return repr(obj)

    @staticmethod
    def _summarize(obj: Any, max_len: int = 200) -> str:
        """Truncated ``repr`` for event payloads."""
        return repr(obj)[:max_len]

    def _result_dict(self, result: ToolResult) -> dict[str, Any]:
        """ToolResult → JSON-safe dict for journal storage."""
        return {"ok": result.ok, "value": self._json_safe(result.value),
                "error": result.error,
                "effect_class": result.effect_class.value if result.effect_class else None,
                "latency_ms": result.latency_ms, "staged": result.staged}

    def _parent_step(self, branch_id: str, step_idx: int) -> int | None:
        """Parent step for journal: fork-point step for idx==0, else idx-1."""
        if step_idx == 0:
            return self._fork_points.get(branch_id, (None, None))[1]
        return step_idx - 1

    def _emit_step(self, branch_id: str, step_idx: int, tool_name: str,
                   args: dict[str, Any], result_summary: str,
                   effect_class: str | None, latency_ms: float) -> None:
        self._events.emit("step", run_id=self._run_id, branch_id=branch_id,
                          parent_branch_id=self._mgr.parent_of(branch_id),
                          step_idx=step_idx,
                          payload={"tool": tool_name,
                                   "args_summary": self._summarize(args),
                                   "result_summary": result_summary,
                                   "effect_class": effect_class,
                                   "latency_ms": latency_ms})

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register_tool(self, name: str, fn: Callable[..., Any],
                      effect_class: EffectClass | str) -> None:
        """Register a tool. ``fn(ctx: ToolContext, args: dict) -> Any``."""
        if isinstance(effect_class, str):
            effect_class = EffectClass(effect_class)
        self._tools[name] = (fn, effect_class)

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def execute(self, branch_id: str, tool_name: str,
                args: dict[str, Any]) -> ToolResult:
        """Execute a tool inside *branch_id*'s sandbox.

        Raises UnknownToolError, IrreversibleInSpeculationError (branch
        survives; journal + event emitted before raise), or DeadBranchError.
        """
        self._mgr.assert_executable(branch_id)
        if tool_name not in self._tools:
            raise UnknownToolError(
                f"Tool '{tool_name}' not registered. Registered: {list(self._tools)}")

        fn, effect_class = self._tools[tool_name]

        # --- IRREVERSIBLE gate ---
        if effect_class == EffectClass.IRREVERSIBLE and self._mgr.is_speculative(branch_id):
            step_idx = self._mgr.next_step(branch_id)
            parent_step = self._parent_step(branch_id, step_idx)
            self._journal.append({
                "run_id": self._run_id, "branch_id": branch_id,
                "step_idx": step_idx, "tool": tool_name, "args": args,
                "result": {"error": "IrreversibleInSpeculationError"},
                "wall_time": 0.0, "parent_step": parent_step,
            })
            self._emit_step(branch_id, step_idx, tool_name, args,
                            "REFUSED: irreversible in speculative branch",
                            "IRREVERSIBLE", 0.0)
            raise IrreversibleInSpeculationError(
                f"Tool '{tool_name}' (IRREVERSIBLE) refused in "
                f"speculative branch '{branch_id}'.")

        # --- Normal execution ---
        step_idx = self._mgr.next_step(branch_id)
        parent_step = self._parent_step(branch_id, step_idx)
        staging_path = self._mgr.branch_dir(branch_id) / "staged_http.jsonl"
        http = self.HttpProxy(self, branch_id, staging_path, "live")
        ctx = ToolContext(branch_id=branch_id,
                          workspace=self._mgr.get_workspace(branch_id),
                          db_path=self._mgr.get_db_path(branch_id), http=http)

        t0 = time.perf_counter()
        try:
            value = fn(ctx, args)
            latency_ms = round((time.perf_counter() - t0) * 1000.0, 3)
            result = ToolResult(ok=True, value=value, effect_class=effect_class,
                                latency_ms=latency_ms)
        except Exception as exc:
            latency_ms = round((time.perf_counter() - t0) * 1000.0, 3)
            result = ToolResult(ok=False, error=f"{type(exc).__name__}: {exc}",
                                effect_class=effect_class, latency_ms=latency_ms)

        # Journal
        self._journal.append({
            "run_id": self._run_id, "branch_id": branch_id,
            "step_idx": step_idx, "tool": tool_name, "args": args,
            "result": self._result_dict(result),
            "wall_time": result.latency_ms, "parent_step": parent_step,
        })
        # Emit step event
        summary = self._summarize(result.error) if result.error else self._summarize(result.value)
        self._emit_step(branch_id, step_idx, tool_name, args, summary,
                        result.effect_class.value if result.effect_class else None,
                        result.latency_ms)
        return result

    # ------------------------------------------------------------------
    # Fork
    # ------------------------------------------------------------------

    def fork(self, parent_branch_id: str, n: int = 1, reason: str = "",
             entropy: float | None = None) -> list[str]:
        """Create *n* speculative children from *parent_branch_id*."""
        children = self._mgr.fork(parent_branch_id, n)
        parent_step = max(0, self._mgr.current_step(parent_branch_id))
        for c in children:
            self._fork_points[c] = (parent_branch_id, parent_step)
        self._events.emit("fork", run_id=self._run_id,
                          branch_id=parent_branch_id,
                          parent_branch_id=self._mgr.parent_of(parent_branch_id),
                          step_idx=parent_step,
                          payload={"children": children, "reason": reason,
                                   "entropy": entropy})
        return children

    # ------------------------------------------------------------------
    # Squash
    # ------------------------------------------------------------------

    def squash(self, branch_id: str, cause: str, detail: str = "") -> None:
        """Delete branch sandbox; idempotent — no event for already-dead branches.

        Raises ValueError for invalid *cause* (must be verifier_rejected |
        error | budget_killed).
        """
        if cause not in _VALID_SQUASH_CAUSES:
            raise ValueError(f"Invalid squash cause '{cause}'; must be one of "
                             f"{set(_VALID_SQUASH_CAUSES)!r}")
        if self._mgr.squash(branch_id):
            self._events.emit("branch_died", run_id=self._run_id,
                              branch_id=branch_id,
                              parent_branch_id=self._mgr.parent_of(branch_id),
                              step_idx=max(0, self._mgr.current_step(branch_id)),
                              payload={"cause": cause, "detail": detail})

    # ------------------------------------------------------------------
    # Commit
    # ------------------------------------------------------------------

    def commit(self, branch_id: str) -> None:
        """Atomically promote *branch_id* to trunk.  Under one lock:
        (1) flush staged HTTP (timeout 5 s, errors swallowed),
        (2) atomic sandbox→trunk rename, (3) auto-squash all other live
        branches as ``verifier_rejected``, (4) emit ``commit`` event."""
        with self._commit_lock:
            # Flush staged HTTP
            staging_path = self._mgr.branch_dir(branch_id) / "staged_http.jsonl"
            flushed = 0
            if staging_path.is_file():
                with open(staging_path) as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        flushed += 1
                        try:
                            rec = json.loads(line)
                            data = rec.get("body")
                            data = data.encode() if isinstance(data, str) else data
                            req = urllib.request.Request(
                                rec.get("url", ""), data=data,
                                headers=rec.get("headers") or {},
                                method=rec.get("method", "GET"))
                            urllib.request.urlopen(req, timeout=5)
                        except Exception:
                            pass

            self._mgr.commit(branch_id)

            for other in self._mgr.live_branches():
                if other != branch_id:
                    self.squash(other, cause="verifier_rejected",
                                detail=f"lost to {branch_id}")

            self._events.emit("commit", run_id=self._run_id,
                              branch_id=branch_id,
                              parent_branch_id=self._mgr.parent_of(branch_id),
                              step_idx=max(0, self._mgr.current_step(branch_id)),
                              payload={"winning_branch": branch_id,
                                       "staged_effects_flushed": flushed})

    # ------------------------------------------------------------------
    # Replay
    # ------------------------------------------------------------------

    def replay(self, branch_id: str, until_step: int) -> Path:
        """Deterministic reconstruction to *until_step*, no real-world effects.

        Copies initial state (workspace + db) into a fresh ``replays/<id>``
        replica, then re-applies every SPECULATABLE_WRITE step from the journal.
        READ / IRREVERSIBLE steps are not re-called — results come from the log.

        Important: write tools must be deterministic functions of (sandbox, args).
        """
        safe = branch_id.replace(".", "_")
        replica = self._root / "replays" / f"{safe}-{uuid.uuid4().hex[:6]}"
        replica.mkdir(parents=True, exist_ok=True)

        initial = self._mgr.initial_dir(branch_id)
        src_ws, dst_ws = initial / "workspace", replica / "workspace"
        if src_ws.is_dir():
            shutil.copytree(src_ws, dst_ws)
        else:
            dst_ws.mkdir(parents=True, exist_ok=True)
        src_db = initial / "state.db"
        if src_db.is_file():
            shutil.copy2(src_db, replica / "state.db")

        dst_db = replica / "state.db"
        for rec in self._journal.for_branch(branch_id, until_step):
            tname = rec.get("tool", "")
            if tname not in self._tools:
                continue
            _, ec = self._tools[tname]
            if ec != EffectClass.SPECULATABLE_WRITE:
                continue
            ctx = ToolContext(branch_id=branch_id, workspace=dst_ws, db_path=dst_db,
                              http=self.HttpProxy(self, branch_id,
                                                  replica / "staged_http.jsonl",
                                                  "replay"))
            try:
                _ = self._tools[tname][0](ctx, rec.get("args", {}))
            except Exception:
                pass

        return replica

    # ------------------------------------------------------------------
    # Fork-at (time-travel)
    # ------------------------------------------------------------------

    def fork_at(self, branch_id: str, step_idx: int, n: int = 1) -> list[str]:
        """Time-travel fork: replay to *step_idx*, fork *n* children from there."""
        replica = self.replay(branch_id, step_idx)
        children = self._mgr.create_branch_from_state(
            branch_id, replica / "workspace", replica / "state.db", n)
        for c in children:
            self._fork_points[c] = (branch_id, step_idx)
        self._events.emit("fork", run_id=self._run_id, branch_id=branch_id,
                          parent_branch_id=self._mgr.parent_of(branch_id),
                          step_idx=step_idx,
                          payload={"children": children, "reason": "fork_at",
                                   "entropy": None})
        shutil.rmtree(replica, ignore_errors=True)
        return children

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------

    def get_workspace(self, branch_id: str) -> Path:
        """Absolute path to *branch_id*'s workspace directory."""
        return self._mgr.get_workspace(branch_id)

    def get_db_path(self, branch_id: str) -> Path:
        """Absolute path to *branch_id*'s SQLite database file."""
        return self._mgr.get_db_path(branch_id)

    def get_step_idx(self, branch_id: str) -> int:
        """Last issued step index for *branch_id*, or -1 if none."""
        return self._mgr.current_step(branch_id)

    def emit_event(self, event: str, branch_id: str,
                   payload: dict | None = None,
                   step_idx: int | None = None) -> None:
        """Public emission for orchestrator-layer events.

        Auto-fills run_id, parent_branch_id; step_idx defaults to
        ``max(get_step_idx(branch_id), 0)``.
        """
        if step_idx is None:
            step_idx = max(self.get_step_idx(branch_id), 0)
        self._events.emit(event, run_id=self._run_id, branch_id=branch_id,
                          parent_branch_id=self._mgr.parent_of(branch_id),
                          step_idx=step_idx, payload=payload or {})

    # ------------------------------------------------------------------
    # Run life-cycle
    # ------------------------------------------------------------------

    def finish_run(self, status: str = "success", detail: str = "") -> None:
        """Emit ``run_finished`` event."""
        self._events.emit("run_finished", run_id=self._run_id,
                          branch_id=BranchManager.TRUNK_ID, parent_branch_id=None,
                          step_idx=0, payload={"status": status, "detail": detail})

    def close(self) -> None:
        """Shut down the event bus."""
        self._events.close()
