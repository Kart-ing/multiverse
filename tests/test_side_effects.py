"""Side-effect pathway tests — HTTP staging, allowlisting, event delivery."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from multiverse import EffectClass, Engine
from multiverse.errors import DeadBranchError
from tests.conftest import read_events


# ---------------------------------------------------------------------------
# HTTP server helpers
# ---------------------------------------------------------------------------

def _new_records():
    """Fresh shared list for a test's server to record requests into."""
    return []


class _RecordHandler(BaseHTTPRequestHandler):
    """Recording handler.  *records* is set per-server via :func:`_start_server`."""

    def do_POST(self):
        cl = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(cl).decode("utf-8", errors="replace") if cl else ""
        self.server._records.append(("POST", self.path, body))
        self._respond(200, b'{"ok":true}')

    def do_GET(self):
        self.server._records.append(("GET", self.path, None))
        self._respond(200, b"hello-from-server")

    def _respond(self, code, body):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


def _start_server(records):
    """Start a ``ThreadingHTTPServer`` on 127.0.0.1:0 storing requests in *records*.

    Returns ``(thread, server, port)``.
    """
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordHandler)
    server._records = records
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return t, server, port


def _stop_server(server):
    server.shutdown()
    server.server_close()


def _write(eng, branch_id, path, content):
    return eng.execute(branch_id, "write_file", {"path": path, "content": content})


# ---------------------------------------------------------------------------
# 1. HTTP staged in speculation — flushed on commit
# ---------------------------------------------------------------------------

def test_http_staged_in_speculation_and_flushed_on_commit(engine, tmp_path):
    records = _new_records()
    t, srv, port = _start_server(records)
    try:
        def _call_api(ctx, args):
            return ctx.http.request("POST", f"http://127.0.0.1:{port}/hook",
                                    body='{"x":1}')

        engine.register_tool("call_api", _call_api, EffectClass.SPECULATABLE_WRITE)

        children = engine.fork("b_root", n=1, reason="test")
        child = children[0]

        # Two calls — both should be staged
        r1 = engine.execute(child, "call_api", {})
        r2 = engine.execute(child, "call_api", {})
        assert r1.ok and r1.value.get("staged") is True
        assert r2.ok and r2.value.get("staged") is True

        # Server saw zero real requests yet
        assert len(records) == 0

        # Staging file has 2 lines
        staging_path = tmp_path / "mv" / "branches" / child / "staged_http.jsonl"
        assert staging_path.is_file()
        lines = staging_path.read_text().strip().splitlines()
        assert len(lines) == 2
        for line in lines:
            assert json.loads(line)["method"] == "POST"

        # Commit — flushes staged effects
        engine.commit(child)

        # Server now saw exactly 2 POSTs to /hook
        post_hooks = [r for r in records if r[0] == "POST" and r[1] == "/hook"]
        assert len(post_hooks) == 2

        # Commit event payload
        events = read_events(tmp_path / "mv")
        commit_ev = [e for e in events if e["event"] == "commit"]
        assert len(commit_ev) == 1
        assert commit_ev[0]["payload"]["staged_effects_flushed"] == 2
    finally:
        _stop_server(srv)


# ---------------------------------------------------------------------------
# 2. Allowlisted GET passes through in speculation
# ---------------------------------------------------------------------------

def test_allowlisted_get_passes_through(engine, tmp_path):
    records = _new_records()
    t, srv, port = _start_server(records)
    try:
        # Rebuild engine with the allowlist
        root = tmp_path / "mv2"
        eng = Engine(root=root, run_id="run_get",
                     http_get_allowlist=["127.0.0.1"])

        def _get_tool(ctx, args):
            return ctx.http.request("GET", f"http://127.0.0.1:{port}/data")

        eng.register_tool("get_tool", _get_tool, EffectClass.SPECULATABLE_WRITE)

        children = eng.fork("b_root", n=1, reason="test")
        child = children[0]

        r = eng.execute(child, "get_tool", {})
        assert r.ok
        assert r.value.get("staged") is False
        assert r.value.get("status") == 200
        assert "hello-from-server" in r.value.get("body", "")

        # Server saw the GET during speculation
        gets = [rec for rec in records if rec[0] == "GET"]
        assert len(gets) == 1
        assert gets[0][1] == "/data"

        eng.close()
    finally:
        _stop_server(srv)


# ---------------------------------------------------------------------------
# 3. Non-allowlisted GET is staged
# ---------------------------------------------------------------------------

def test_non_allowlisted_get_staged(engine, tmp_path):
    records = _new_records()
    t, srv, port = _start_server(records)
    try:
        def _get_tool(ctx, args):
            return ctx.http.request("GET", f"http://127.0.0.1:{port}/data")

        engine.register_tool("get_tool", _get_tool, EffectClass.SPECULATABLE_WRITE)

        children = engine.fork("b_root", n=1, reason="test")
        child = children[0]

        r = engine.execute(child, "get_tool", {})
        assert r.ok
        assert r.value.get("staged") is True

        # Server untouched
        assert len(records) == 0

        # Staging file has the GET
        staging_path = tmp_path / "mv" / "branches" / child / "staged_http.jsonl"
        assert staging_path.is_file()
        rec = json.loads(staging_path.read_text().strip().splitlines()[0])
        assert rec["method"] == "GET"
    finally:
        _stop_server(srv)


# ---------------------------------------------------------------------------
# 4. Trunk HTTP performs immediately
# ---------------------------------------------------------------------------

def test_trunk_http_performs_immediately(engine, tmp_path):
    records = _new_records()
    t, srv, port = _start_server(records)
    try:
        def _call_api(ctx, args):
            return ctx.http.request("POST", f"http://127.0.0.1:{port}/hook",
                                    body='{"x":1}')

        engine.register_tool("call_api", _call_api, EffectClass.SPECULATABLE_WRITE)

        r = engine.execute("b_root", "call_api", {})
        assert r.ok
        assert r.value.get("staged") is False
        assert r.value.get("status") == 200

        # Server saw the POST immediately
        posts = [rec for rec in records if rec[0] == "POST" and rec[1] == "/hook"]
        assert len(posts) == 1
    finally:
        _stop_server(srv)


# ---------------------------------------------------------------------------
# 5. Ingest URL fire-and-forget delivery
# ---------------------------------------------------------------------------

def test_ingest_url_receives_events_fire_and_forget(tmp_path):
    records = _new_records()
    t, srv, port = _start_server(records)
    try:
        root = tmp_path / "mv_ingest"
        eng = Engine(
            root=root,
            run_id="run_ingest",
            ingest_url=f"http://127.0.0.1:{port}/ingest",
        )

        def _noop(ctx, args):
            return {"ok": True}

        eng.register_tool("noop", _noop, EffectClass.SPECULATABLE_WRITE)

        # Produce events: fork + step + finish_run
        eng.fork("b_root", n=1, reason="delivery-test")
        eng.execute("b_root.1", "noop", {})
        eng.finish_run()

        eng.close()

        # Poll briefly for delivery (background daemon, ≤2 s)
        deadline = time.time() + 2.0
        while time.time() < deadline:
            if len(records) >= 3:
                break
            time.sleep(0.05)

        ingest_posts = [r for r in records if r[0] == "POST" and r[1] == "/ingest"]
        assert len(ingest_posts) >= 3, f"expected >=3 ingest POSTs, got {len(ingest_posts)}"

        for _, _, body in ingest_posts:
            ev = json.loads(body)
            assert "event" in ev
            assert ev["event"] in {
                "step", "fork", "branch_died", "commit",
                "run_started", "run_finished", "verifier_score",
            }
    finally:
        _stop_server(srv)


def test_dead_ingest_never_blocks(tmp_path):
    root = tmp_path / "mv_dead"
    eng = Engine(
        root=root,
        run_id="run_dead",
        ingest_url="http://127.0.0.1:9/dead",
    )

    def _noop(ctx, args):
        return {"ok": True}

    eng.register_tool("noop", _noop, EffectClass.SPECULATABLE_WRITE)

    t0 = time.perf_counter()
    r = eng.execute("b_root", "noop", {})
    elapsed = time.perf_counter() - t0

    assert r.ok
    assert elapsed < 1.0, f"execute blocked for {elapsed:.3f}s on dead ingest"

    eng.close()


# ---------------------------------------------------------------------------
# 6. ClickHouse config without server is silent
# ---------------------------------------------------------------------------

def test_clickhouse_config_without_server_is_silent(tmp_path):
    root = tmp_path / "mv_ch"
    eng = Engine(
        root=root,
        run_id="run_ch",
        clickhouse={"host": "127.0.0.1", "port": 9, "table": "events"},
    )

    def _noop(ctx, args):
        return {"ok": True}

    eng.register_tool("noop", _noop, EffectClass.SPECULATABLE_WRITE)

    # Construction + step + close all succeed without raising
    r = eng.execute("b_root", "noop", {})
    assert r.ok

    eng.finish_run()
    eng.close()


# ---------------------------------------------------------------------------
# 7. Fork-after-commit continuation (survivor-continues loop)
# ---------------------------------------------------------------------------

def test_fork_after_commit_continuation(engine, tmp_path):
    # Fork 2 off b_root, different writes, commit branch 1
    children = engine.fork("b_root", n=2, reason="continuation")
    c0, c1 = children  # b_root.1, b_root.2

    _write(engine, c0, "a.txt", "branch-zero")
    _write(engine, c1, "b.txt", "branch-one")

    # Commit c0
    engine.commit(c0)

    # Trunk now has c0's file
    trunk_ws = engine.get_workspace("b_root")
    assert (trunk_ws / "a.txt").read_text() == "branch-zero"
    assert not (trunk_ws / "b.txt").exists()

    # c1 is dead after auto-squash
    with pytest.raises(DeadBranchError):
        engine.get_workspace(c1)

    # Fork from the committed winner (b_root.1) with n=2
    grandkids = engine.fork(c0, n=2)
    g0, g1 = grandkids  # b_root.1.1, b_root.1.2

    # Children see the winner's file content (inherited from trunk)
    for gk in grandkids:
        ws = engine.get_workspace(gk)
        assert (ws / "a.txt").read_text() == "branch-zero"

    # Write in a child
    _write(engine, g0, "c.txt", "grandchild-content")

    # Commit that child
    engine.commit(g0)

    # Trunk reflects both commits
    trunk_ws = engine.get_workspace("b_root")
    assert (trunk_ws / "a.txt").read_text() == "branch-zero"
    assert (trunk_ws / "c.txt").read_text() == "grandchild-content"

    # Second commit event exists
    events = read_events(tmp_path / "mv")
    commit_events = [e for e in events if e["event"] == "commit"]
    assert len(commit_events) == 2
    assert commit_events[1]["payload"]["winning_branch"] == g0
