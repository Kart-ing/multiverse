import hashlib
import json
import os
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def tree_hash(root: Path) -> str:
    """Walk tree sorted, SHA256 over each file's relative posix path +
    b'\\0' + file bytes.  Returns hex digest."""
    h = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fname in sorted(filenames):
            fpath = os.path.join(dirpath, fname)
            rel = os.path.relpath(fpath, root)
            rel_posix = Path(rel).as_posix()
            h.update(rel_posix.encode("utf-8"))
            h.update(b"\x00")
            with open(fpath, "rb") as f:
                h.update(f.read())
    return h.hexdigest()


def read_events(engine_root: Path) -> list[dict]:
    """Parse every line of ``events.jsonl`` into a list of dicts."""
    events_path = engine_root / "events.jsonl"
    if not events_path.exists():
        return []
    events = []
    with open(events_path) as fh:
        for line in fh:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return events


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def engine(tmp_path):
    """Engine with four registered tools, rooted at tmp_path/mv."""
    from multiverse import Engine  # noqa: PLC0415 – lazy, engine.py may be WIP

    root = tmp_path / "mv"

    def _write_file(ctx, args):
        (ctx.workspace / args["path"]).write_text(args["content"])
        return {"written": args["path"]}

    def _read_file(ctx, args):
        return (ctx.workspace / args["path"]).read_text()

    def _append_file(ctx, args):
        p = ctx.workspace / args["path"]
        p.write_text(p.read_text() + args["content"])
        return {"appended": args["path"]}

    def _send_email(ctx, args):
        return {"sent": True}

    eng = Engine(root=root, run_id="run_test")
    eng.register_tool("write_file", _write_file, "SPECULATABLE_WRITE")
    eng.register_tool("read_file", _read_file, "READ")
    eng.register_tool("append_file", _append_file, "SPECULATABLE_WRITE")
    eng.register_tool("send_email", _send_email, "IRREVERSIBLE")
    yield eng
    eng.close()
