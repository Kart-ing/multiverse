"""Event bus — the shared event stream for the Multiverse engine.

Events are synchronously appended to a local JSONL file and optionally
fire-and-forget delivered to an HTTP ingest endpoint and/or ClickHouse.
"""

from __future__ import annotations

import atexit
import json
import queue
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request


class EventBus:
    """Append-only JSONL event stream with optional remote delivery.

    Every event is written synchronously to *jsonl_path* so tests can
    read it immediately after ``emit()`` returns.  Remote delivery
    (HTTP and/or ClickHouse) is performed on a background daemon thread
    and must never block or crash the caller.
    """

    EVENTS = {
        "step",
        "fork",
        "branch_died",
        "commit",
        "run_started",
        "run_finished",
        "verifier_score",
    }

    def __init__(
        self,
        jsonl_path: Path,
        ingest_url: str | None = None,
        clickhouse: dict[str, Any] | None = None,
    ) -> None:
        self._jsonl_path = Path(jsonl_path)
        self._jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        self._ingest_url = ingest_url
        self._clickhouse_config = clickhouse
        self._lock = threading.Lock()
        self._queue: queue.Queue[dict[str, Any] | None] = queue.Queue()
        self._closed = False
        self._clickhouse_failed = False

        self._worker = threading.Thread(target=self._deliver, daemon=True)
        self._worker.start()
        atexit.register(self.close)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def emit(
        self,
        event: str,
        *,
        run_id: str,
        branch_id: str,
        parent_branch_id: str | None = None,
        step_idx: int = 0,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Emit a single event to the bus.

        Raises ``ValueError`` if *event* is not in ``EVENTS``.
        """
        if event not in self.EVENTS:
            raise ValueError(
                f"Unknown event {event!r}; must be one of {sorted(self.EVENTS)}"
            )

        if payload is None:
            payload = {}

        now = datetime.now(timezone.utc)
        ts = (
            now.strftime("%Y-%m-%dT%H:%M:%S.")
            + f"{now.microsecond // 1000:03d}Z"
        )

        event_dict: dict[str, Any] = {
            "ts": ts,
            "run_id": run_id,
            "event": event,
            "branch_id": branch_id,
            "parent_branch_id": parent_branch_id,
            "step_idx": step_idx,
            "payload": payload,
        }

        # ---- synchronous JSONL append -----------------------------------
        line = json.dumps(event_dict, ensure_ascii=False)
        with self._lock:
            with open(self._jsonl_path, "a") as fh:
                fh.write(line + "\n")
                fh.flush()

        # ---- fire-and-forget remote delivery ----------------------------
        if self._ingest_url or (
            self._clickhouse_config and not self._clickhouse_failed
        ):
            self._queue.put(event_dict)

    def close(self) -> None:
        """Drain the background delivery queue and shut down the worker.

        Idempotent — safe to call multiple times.  Waits at most ~2 s
        for outstanding deliveries to complete.
        """
        if self._closed:
            return
        self._closed = True
        self._queue.put(None)  # sentinel
        self._worker.join(timeout=2.0)

    # ------------------------------------------------------------------
    # Background worker
    # ------------------------------------------------------------------

    def _deliver(self) -> None:
        """Consume the work queue and deliver events to remote sinks."""
        while True:
            item = self._queue.get()
            if item is None:  # sentinel — shut down
                break

            if self._ingest_url:
                self._deliver_http(item)

            if self._clickhouse_config and not self._clickhouse_failed:
                self._deliver_clickhouse(item)

    # ------------------------------------------------------------------
    # Remote delivery helpers
    # ------------------------------------------------------------------

    def _deliver_http(self, event_dict: dict[str, Any]) -> None:
        """POST the event JSON to *ingest_url*.  Swallow all errors."""
        try:
            data = json.dumps(event_dict, ensure_ascii=False).encode("utf-8")
            req = request.Request(
                self._ingest_url,  # type: ignore[arg-type]
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            request.urlopen(req, timeout=2.0)
        except Exception:
            pass  # fire-and-forget — never let the engine crash

    def _deliver_clickhouse(self, event_dict: dict[str, Any]) -> None:
        """Try to insert *event_dict* into ClickHouse.

        On the first failure the *clickhouse* sink is permanently
        disabled for the lifetime of this bus instance.
        """
        try:
            import clickhouse_connect
        except ImportError:
            self._clickhouse_failed = True
            return

        try:
            cfg = self._clickhouse_config
            client = clickhouse_connect.get_client(
                host=cfg.get("host", "localhost"),
                port=cfg.get("port", 8123),
                username=cfg.get("username", "default"),
                password=cfg.get("password", ""),
                database=cfg.get("database", "default"),
            )
            table = cfg.get("table", "events")

            row = [
                event_dict["ts"],
                event_dict["run_id"],
                event_dict["event"],
                event_dict["branch_id"],
                event_dict["parent_branch_id"],
                event_dict["step_idx"],
                json.dumps(event_dict["payload"], ensure_ascii=False),
            ]
            client.insert(
                table,
                [row],
                column_names=[
                    "ts",
                    "run_id",
                    "event",
                    "branch_id",
                    "parent_branch_id",
                    "step_idx",
                    "payload",
                ],
            )
        except Exception:
            self._clickhouse_failed = True
