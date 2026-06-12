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
        self._clickhouse_client: Any = None
        self._clickhouse_consecutive_failures = 0

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

    def close(self, timeout: float = 10.0) -> None:
        """Drain the background delivery queue and shut down the worker.

        Idempotent — safe to call multiple times.  Waits at most *timeout*
        seconds for outstanding deliveries to complete.
        """
        if self._closed:
            return
        self._closed = True
        self._queue.put(None)  # sentinel
        self._worker.join(timeout=timeout)

    # ------------------------------------------------------------------
    # Background worker
    # ------------------------------------------------------------------

    def _deliver(self) -> None:
        """Consume the work queue and deliver events to remote sinks."""
        while True:
            item = self._queue.get()
            if item is None:  # sentinel — shut down
                break

            # Drain everything else currently in the queue
            batch = [item]
            while True:
                try:
                    nxt = self._queue.get_nowait()
                except queue.Empty:
                    break
                if nxt is None:  # sentinel mid-batch — deliver then exit
                    self._deliver_batch(batch)
                    return
                batch.append(nxt)

            self._deliver_batch(batch)

    # ------------------------------------------------------------------
    # Batch delivery
    # ------------------------------------------------------------------

    def _deliver_batch(self, batch: list[dict[str, Any]]) -> None:
        """Deliver a batch of events to remote sinks.

        HTTP is sent one event per POST (unchanged behaviour).
        ClickHouse inserts all rows in a single call.
        """
        if self._ingest_url:
            for event_dict in batch:
                self._deliver_http(event_dict)

        if self._clickhouse_config and not self._clickhouse_failed:
            self._deliver_clickhouse(batch)

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

    def _deliver_clickhouse(self, batch: list[dict[str, Any]]) -> None:
        """Try to insert *batch* of events into ClickHouse.

        A single client is lazily created on first insert and reused for
        the bus lifetime.  On insert failure the client is discarded,
        recreated once, and the batch retried once.  After 3 consecutive
        failed batches the sink is permanently disabled.
        """
        try:
            import clickhouse_connect
        except ImportError:
            self._clickhouse_failed = True
            return

        cfg = self._clickhouse_config
        table = cfg.get("table", "events")

        column_names = [
            "ts",
            "run_id",
            "event",
            "branch_id",
            "parent_branch_id",
            "step_idx",
            "payload",
        ]

        rows = []
        for event_dict in batch:
            row = [
                event_dict["ts"],
                event_dict["run_id"],
                event_dict["event"],
                event_dict["branch_id"],
                event_dict["parent_branch_id"],
                event_dict["step_idx"],
                json.dumps(event_dict["payload"], ensure_ascii=False),
            ]
            rows.append(row)

        for attempt in range(2):
            try:
                if self._clickhouse_client is None:
                    self._clickhouse_client = clickhouse_connect.get_client(
                        host=cfg.get("host", "localhost"),
                        port=cfg.get("port", 8123),
                        username=cfg.get("username", "default"),
                        password=cfg.get("password", ""),
                        database=cfg.get("database", "default"),
                    )
                self._clickhouse_client.insert(
                    table, rows, column_names=column_names
                )
                self._clickhouse_consecutive_failures = 0
                return
            except Exception:
                self._clickhouse_client = None  # discard faulty client
                if attempt == 0:
                    continue  # retry once with a fresh client
                self._clickhouse_consecutive_failures += 1
                if self._clickhouse_consecutive_failures >= 3:
                    self._clickhouse_failed = True
                return
