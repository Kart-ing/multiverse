"""Live-ticker demo task: prove the system acts on real-time data unattended.

The story: a value in the outside world changes *mid-run*. Universes that were
built on the value read **before** the decision point hold stale data and never
become real; the universe that **re-checks** the live value right before acting
wins and is the one committed.

Determinism (no sleeps, no thread-race assumptions): the world change is driven
by the server, keyed on **request count**, not wall-clock.  ``TickerServer`` is
constructed with ``bump_after_requests=1``: it serves the original value to the
first ``GET /value`` (the pre-fork read on the trunk) and then bumps itself, so
every read issued *after* the fork — branch C's fresh re-read and the verifier's
read — observes the new value.  Greedy single-path (speculation OFF) reads once
before writing and never re-checks, so it writes the stale value and fails;
speculation ON forks, and branch C re-reads after the world moved and wins.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .engine import Engine
from .orchestrator import Action, ProgrammaticVerifier, Task

# File (inside each branch workspace) where ``read_ticker`` records the value it
# fetched.  The pre-fork read writes the stale value here on the trunk; children
# inherit it.  Branch C overwrites it with a fresh read before answering.
TICKER_READ_FILE = "ticker_read.txt"
ANSWER_FILE = "answer.txt"


class TickerServer:
    """Thread-safe in-process HTTP source of a single integer "world" value.

    ``GET /value`` returns ``{"value": N}``.  The value is controlled
    programmatically via :meth:`set_value` / :meth:`bump`.  When constructed with
    ``bump_after_requests=k`` (k > 0) the server auto-bumps once, immediately
    after it has served exactly ``k`` ``GET /value`` requests — a deterministic
    "the world moved" signal that does not depend on timing.

    Use as a context manager (binds to an OS-assigned port on ``host`` and serves
    on a daemon thread)::

        with TickerServer(initial=41, bump_after_requests=1) as ticker:
            url = ticker.url  # http://127.0.0.1:<port>/value
    """

    def __init__(
        self,
        initial: int = 41,
        *,
        host: str = "127.0.0.1",
        bump_after_requests: int = 0,
        bump_step: int = 6,
    ) -> None:
        self._host = host
        self._bump_step = bump_step
        self._bump_after_requests = bump_after_requests
        self._lock = threading.Lock()
        self._value = initial
        self._serve_count = 0
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    # -- value control (thread-safe) ----------------------------------------

    def set_value(self, n: int) -> None:
        with self._lock:
            self._value = int(n)

    def bump(self, step: int | None = None) -> int:
        with self._lock:
            self._value += self._bump_step if step is None else int(step)
            return self._value

    @property
    def value(self) -> int:
        with self._lock:
            return self._value

    @property
    def serve_count(self) -> int:
        with self._lock:
            return self._serve_count

    def _serve_value(self) -> int:
        """Return the current value, then auto-bump if the request threshold is
        now met.  Called once per served ``GET /value`` (under the lock)."""
        with self._lock:
            served = self._value
            self._serve_count += 1
            if self._bump_after_requests and self._serve_count == self._bump_after_requests:
                self._value += self._bump_step
            return served

    # -- lifecycle ----------------------------------------------------------

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path.rstrip("/") == "/value":
                    body = json.dumps({"value": server._serve_value()}).encode("utf-8")
                    self.send_response(200)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_error(404)

            def log_message(self, fmt: str, *args: Any) -> None:  # silence stderr
                return

        return Handler

    def start(self) -> "TickerServer":
        if self._httpd is not None:
            return self
        self._httpd = ThreadingHTTPServer((self._host, 0), self._handler())
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None

    @property
    def port(self) -> int:
        if self._httpd is None:
            raise RuntimeError("TickerServer not started")
        return self._httpd.server_address[1]

    @property
    def url(self) -> str:
        return f"http://{self._host}:{self.port}/value"

    def __enter__(self) -> "TickerServer":
        return self.start()

    def __exit__(self, *exc: Any) -> None:
        self.stop()


# ---------------------------------------------------------------------------
# Tools (registered onto the engine for this task)
# ---------------------------------------------------------------------------


def register_ticker_tools(engine: Engine) -> None:
    """Register the ``read_ticker`` READ tool and the ``write_answer_from_read``
    SPECULATABLE_WRITE tool used by the live-ticker task.

    Idempotent-safe to call once per engine.  ``read_ticker`` fetches the live
    value through ``ctx.http`` (the engine's HttpProxy) and records it into the
    branch workspace; ``write_answer_from_read`` copies that recorded value into
    ``answer.txt`` — so a branch that re-reads before writing answers fresh, and
    one that does not answers with whatever the pre-fork read recorded.
    """
    from .types import EffectClass

    def read_ticker(ctx, args):
        resp = ctx.http.request("GET", args["url"])
        # Allowlisted GETs pass through (staged is False) and carry a body.
        body = resp.get("body") or "{}"
        value = int(json.loads(body)["value"])
        (ctx.workspace / TICKER_READ_FILE).write_text(str(value), encoding="utf-8")
        return {"value": str(value), "staged": str(resp.get("staged", False))}

    def write_answer_from_read(ctx, args):
        recorded = (ctx.workspace / TICKER_READ_FILE).read_text(encoding="utf-8").strip()
        (ctx.workspace / ANSWER_FILE).write_text(recorded, encoding="utf-8")
        return {"path": ANSWER_FILE, "value": recorded}

    if "read_ticker" not in engine._tools:
        engine.register_tool("read_ticker", read_ticker, EffectClass.READ)
    if "write_answer_from_read" not in engine._tools:
        engine.register_tool("write_answer_from_read", write_answer_from_read, EffectClass.SPECULATABLE_WRITE)


# ---------------------------------------------------------------------------
# Task factory
# ---------------------------------------------------------------------------


def build_live_ticker_task(url: str, server: TickerServer) -> Task:
    """Build the ``live_ticker`` Task wired against a running :class:`TickerServer`.

    * Trunk prefix reads the ticker (request #1) → server bumps "the world".
    * Speculation forks 3 branches at the low-confidence write:
        - A & B answer from the stale pre-fork read (they never re-check).
        - C re-reads the now-current value, then answers (fresh).
    * The verifier fetches the CURRENT value at verification time; a branch
      passes only if its ``answer.txt`` equals it.  Stale branches die with
      ``"stale data: had <answer>, world moved to <current>"``.

    Speculation OFF runs ``initial_actions`` greedily on the trunk: read once,
    write the stale value, never re-check → fails.  Speculation ON: branch C wins.
    """

    def check(engine: Engine, branch_id: str, task: Task) -> tuple[bool, str, float]:
        current = server.value
        answer = engine.get_workspace(branch_id) / ANSWER_FILE
        if not answer.exists():
            return False, f"stale data: had <none>, world moved to {current}", 0.0
        had = answer.read_text(encoding="utf-8").strip()
        passed = had == str(current)
        if passed:
            return True, f"fresh: matched live value {current}", 1.0
        return False, f"stale data: had {had}, world moved to {current}", 0.0

    read = Action("read_ticker", {"url": url}, 1.0, "read live ticker before deciding")
    # Low-confidence write at the decision point => the fork trigger.
    stale_write = Action("write_answer_from_read", {}, 0.4, "answer from the value just read")
    fresh_plan = [
        Action("read_ticker", {"url": url}, 0.95, "re-check the live ticker before writing"),
        Action("write_answer_from_read", {}, 0.95, "answer from the freshly re-read value"),
    ]
    stale_plan = [Action("write_answer_from_read", {}, 0.7, "answer from the pre-fork (stale) read")]

    return Task(
        task_id="live_ticker",
        title="Act on a live value that changes mid-run",
        prompt=(
            "Read the live ticker and write its current value to answer.txt. "
            "The value can change while you work — your answer must match the "
            "value at the moment you commit."
        ),
        initial_actions=[read, stale_write],
        # Branch C (fresh re-read) is last so the highest-scoring *passing* branch
        # is unambiguous; A and B hold the stale value and die.
        alternatives=[stale_plan, stale_plan, fresh_plan],
        verifier=ProgrammaticVerifier(check).verify,
    )
