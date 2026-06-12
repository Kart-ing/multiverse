"""Shared JSONL event sink for the engine, orchestrator, and UI."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


EVENT_NAMES = {
    "step",
    "fork",
    "branch_died",
    "commit",
    "run_started",
    "run_finished",
    "verifier_score",
}


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class Event:
    ts: str
    run_id: str
    event: str
    branch_id: str
    parent_branch_id: str | None
    step_idx: int
    payload: dict[str, Any]

    def to_json(self) -> str:
        return json.dumps(self.__dict__, sort_keys=True)


class EventSink:
    """Append-only JSONL event stream matching the shared contract."""

    def __init__(self, path: str | Path = "events.jsonl", run_id: str = "run_dev") -> None:
        self.path = Path(path)
        self.run_id = run_id
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def emit(
        self,
        event: str,
        branch_id: str,
        *,
        parent_branch_id: str | None = None,
        step_idx: int = 0,
        payload: dict[str, Any] | None = None,
    ) -> Event:
        if event not in EVENT_NAMES:
            raise ValueError(f"unknown event: {event}")
        record = Event(
            ts=utc_now_iso(),
            run_id=self.run_id,
            event=event,
            branch_id=branch_id,
            parent_branch_id=parent_branch_id,
            step_idx=step_idx,
            payload=payload or {},
        )
        with self._lock:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(record.to_json() + "\n")
        return record

    def reset(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text("", encoding="utf-8")

