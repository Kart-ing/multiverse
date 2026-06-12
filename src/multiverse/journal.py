"""Record/replay journal — the append-only JSONL log.

Every ``engine.execute()`` appends a record; this class provides
filtered and sorted reads so the engine can replay a branch from the
log without re-invoking real tools.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any


class Journal:
    """Append-only JSONL log of tool-call records.

    Thread-safe for concurrent appends from parallel branch workers.
    Reads open the file fresh each call (cheap at hackathon scale).
    """

    def __init__(self, path: Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Writing
    # ------------------------------------------------------------------

    def append(self, record: dict[str, Any]) -> None:
        """Append a single record as one JSON line.

        Uses ``repr`` as the JSON fallback for any value that
        ``json.dumps`` cannot serialise natively (e.g. datetimes,
        exceptions, custom objects).  The file is flushed after every
        write so concurrent readers always see complete lines.
        """
        line = json.dumps(record, default=repr, ensure_ascii=False)
        with self._lock:
            with open(self._path, "a") as fh:
                fh.write(line + "\n")
                fh.flush()

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------

    def for_branch(
        self, branch_id: str, until_step: int | None = None
    ) -> list[dict[str, Any]]:
        """Return records for *branch_id*, optionally up to *until_step*.

        Results are sorted by ``step_idx`` ascending.  The file is
        re-read from disk on every call.
        """
        records: list[dict[str, Any]] = []
        try:
            with open(self._path, "r") as fh:
                for line in fh:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    try:
                        rec = json.loads(stripped)
                    except json.JSONDecodeError:
                        continue
                    if rec.get("branch_id") == branch_id:
                        step = rec.get("step_idx", 0)
                        if until_step is None or step <= until_step:
                            records.append(rec)
        except FileNotFoundError:
            pass

        records.sort(key=lambda r: r.get("step_idx", 0))
        return records

    def all(self) -> list[dict[str, Any]]:
        """Return every record in file order, skipping unparseable lines."""
        records: list[dict[str, Any]] = []
        try:
            with open(self._path, "r") as fh:
                for line in fh:
                    stripped = line.strip()
                    if not stripped:
                        continue
                    try:
                        records.append(json.loads(stripped))
                    except json.JSONDecodeError:
                        continue
        except FileNotFoundError:
            pass
        return records
