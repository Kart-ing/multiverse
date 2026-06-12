"""Acceptance test suite for the Multiverse Engine (PRD §8)."""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest

from multiverse.errors import DeadBranchError, IrreversibleInSpeculationError
from tests.conftest import read_events, tree_hash


# ---------------------------------------------------------------------------
# helpers for tests
# ---------------------------------------------------------------------------

def _write(eng, branch_id, path, content):
    return eng.execute(branch_id, "write_file", {"path": path, "content": content})


def _read(eng, branch_id, path):
    return eng.execute(branch_id, "read_file", {"path": path})


def _append(eng, branch_id, path, content):
    return eng.execute(branch_id, "append_file", {"path": path, "content": content})


# ---------------------------------------------------------------------------
# 1. Fork isolation + commit
# ---------------------------------------------------------------------------

def test_fork_isolation_and_commit(engine, tmp_path):
    children = engine.fork("b_root", n=3, reason="test")
    assert children == ["b_root.1", "b_root.2", "b_root.3"]

    values = {children[0]: "alpha", children[1]: "beta", children[2]: "gamma"}
    for bid, val in values.items():
        r = _write(engine, bid, "answer.txt", val)
        assert r.ok

    # trunk has no answer.txt while branches are live
    trunk_ws = engine.get_workspace("b_root")
    assert not (trunk_ws / "answer.txt").exists()

    # each branch reads back only its own value
    for bid, val in values.items():
        r = _read(engine, bid, "answer.txt")
        assert r.ok
        assert r.value == val

    # commit branch 2 (beta)
    engine.commit(children[1])

    # trunk now has answer.txt == "beta"
    trunk_ws = engine.get_workspace("b_root")
    assert (trunk_ws / "answer.txt").read_text() == "beta"

    # branches 0 and 2 are dead
    for bid in (children[0], children[2]):
        with pytest.raises(DeadBranchError):
            engine.get_workspace(bid)
        # workspace dirs no longer exist on disk
        branch_ws = tmp_path / "mv" / "branches" / bid / "workspace"
        assert not branch_ws.exists()

    # exactly one commit event
    engine_root = tmp_path / "mv"
    events = read_events(engine_root)
    commit_events = [e for e in events if e["event"] == "commit"]
    assert len(commit_events) == 1
    assert commit_events[0]["payload"]["winning_branch"] == children[1]


# ---------------------------------------------------------------------------
# 2. Irreversible refused in speculation, allowed on trunk
# ---------------------------------------------------------------------------

def test_irreversible_refused_in_speculation(engine, tmp_path):
    children = engine.fork("b_root", n=1, reason="test")
    child = children[0]

    # irreversible on speculative branch raises
    with pytest.raises(IrreversibleInSpeculationError):
        engine.execute(child, "send_email", {})

    # branch SURVIVES – a subsequent write_file succeeds
    r = _write(engine, child, "note.txt", "still-alive")
    assert r.ok

    # events.jsonl contains a step event whose payload mentions the refusal
    engine_root = tmp_path / "mv"
    events = read_events(engine_root)
    refusal_steps = [
        e
        for e in events
        if e["event"] == "step"
        and e["payload"].get("effect_class") == "IRREVERSIBLE"
        and "REFUSED" in (e["payload"].get("result_summary") or "")
    ]
    assert len(refusal_steps) >= 1

    # on trunk, send_email succeeds
    r = engine.execute("b_root", "send_email", {})
    assert r.ok
    assert r.value == {"sent": True}


# ---------------------------------------------------------------------------
# 3. Replay byte-identical workspace
# ---------------------------------------------------------------------------

def test_replay_byte_identical(engine, tmp_path):
    children = engine.fork("b_root", n=1, reason="test")
    child = children[0]

    # step 0
    _write(engine, child, "a.txt", "v1")
    # step 1
    _append(engine, child, "a.txt", "+x")
    # step 2
    _write(engine, child, "b.txt", "bb")

    h2 = tree_hash(engine.get_workspace(child))

    # step 3
    _append(engine, child, "b.txt", "+y")
    # step 4
    _write(engine, child, "c.txt", "cc")

    h4 = tree_hash(engine.get_workspace(child))

    # replay to step 2
    replica2 = engine.replay(child, until_step=2)
    assert tree_hash(replica2 / "workspace") == h2

    # replay to step 4
    replica4 = engine.replay(child, until_step=4)
    assert tree_hash(replica4 / "workspace") == h4

    # replay works on a DEAD branch too
    engine.squash(child, cause="verifier_rejected", detail="")
    replica_dead = engine.replay(child, until_step=2)
    assert tree_hash(replica_dead / "workspace") == h2


# ---------------------------------------------------------------------------
# 4. Events parse + lineage consistency
# ---------------------------------------------------------------------------

def test_events_parse_and_lineage(engine, tmp_path):
    # full scenario: fork 3, a few writes per branch, one refusal,
    # commit one, finish_run
    children = engine.fork("b_root", n=3, reason="test")
    c0, c1, c2 = children

    # writes on each branch
    _write(engine, c0, "x.txt", "hello")
    _write(engine, c0, "y.txt", "world")

    _write(engine, c1, "a.txt", "foo")
    _write(engine, c1, "b.txt", "bar")

    _write(engine, c2, "p.txt", "baz")

    # one refusal attempt on a speculative branch
    try:
        engine.execute(c2, "send_email", {})
    except IrreversibleInSpeculationError:
        pass

    # commit c1
    engine.commit(c1)

    # finish the run
    engine.finish_run()

    engine_root = tmp_path / "mv"
    events = read_events(engine_root)

    assert len(events) > 0, "expected at least one event"

    for ev in events:
        # every line json-parses (already done by read_events)

        # event type is known
        assert ev["event"] in {
            "step",
            "fork",
            "branch_died",
            "commit",
            "run_started",
            "run_finished",
            "verifier_score",
        }, f"unknown event type: {ev['event']}"

        # ts is ISO8601 – parseable as UTC datetime
        datetime.fromisoformat(ev["ts"])

        # lineage checks for non-root dotted branch_ids
        bid = ev["branch_id"]
        if bid and "." in bid and ev["event"] in ("step", "branch_died"):
            expected_parent = bid.rsplit(".", 1)[0]
            actual_parent = ev.get("parent_branch_id")
            assert (
                actual_parent == expected_parent
            ), f"parent_branch_id mismatch for {bid}: got {actual_parent}, want {expected_parent}"

        # fork events: every child starts with branch_id + "."
        if ev["event"] == "fork":
            for child_id in ev["payload"].get("children", []):
                assert child_id.startswith(
                    ev["branch_id"] + "."
                ), f"fork child {child_id} does not start with {ev['branch_id']}."

    # exactly one commit event
    commit_events = [e for e in events if e["event"] == "commit"]
    assert len(commit_events) == 1

    # every non-winning forked branch has exactly one branch_died event
    winning = commit_events[0]["payload"]["winning_branch"]
    forked = {c0, c1, c2}
    for bid in forked - {winning}:
        died = [e for e in events if e["event"] == "branch_died" and e["branch_id"] == bid]
        assert len(died) == 1, f"branch {bid} missing branch_died event"


# ---------------------------------------------------------------------------
# 5. Parallel branches stress test
# ---------------------------------------------------------------------------

def test_parallel_branches_stress(engine, tmp_path):
    children = engine.fork("b_root", n=3, reason="stress")
    errors = []

    def worker(branch_id):
        try:
            for i in range(10):
                r = _write(engine, branch_id, f"step{i}.txt", f"{branch_id}-{i}")
                assert r.ok, f"write failed on {branch_id} step {i}"
        except Exception as exc:
            errors.append((branch_id, exc))

    threads = [threading.Thread(target=worker, args=(bid,)) for bid in children]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"thread errors: {errors}"

    for bid in children:
        ws = engine.get_workspace(bid)
        for i in range(10):
            fpath = ws / f"step{i}.txt"
            assert fpath.exists(), f"missing {fpath}"
            assert fpath.read_text() == f"{bid}-{i}", f"wrong content in {fpath}"

    # journal has step_idx 0..9 exactly once per branch
    journal_path = tmp_path / "mv" / "journal.jsonl"
    journal_entries = []
    if journal_path.exists():
        with open(journal_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    journal_entries.append(json.loads(line))
    # journal records (schema: run_id, branch_id, step_idx, tool, ...) — one per write
    step_records_by_branch = {}
    for entry in journal_entries:
        if "tool" in entry:
            bid = entry["branch_id"]
            step_records_by_branch.setdefault(bid, []).append(entry["step_idx"])
    for bid in children:
        assert sorted(step_records_by_branch.get(bid, [])) == list(
            range(10)
        ), f"step_idx mismatch for {bid}"


# ---------------------------------------------------------------------------
# 6. Fork-at (time-travel fork)
# ---------------------------------------------------------------------------

def test_fork_at_time_travel(engine, tmp_path):
    children = engine.fork("b_root", n=1, reason="test")
    child = children[0]

    # 3 write steps
    _write(engine, child, "a.txt", "v1")  # step 0
    _append(engine, child, "a.txt", "+v2")  # step 1
    _write(engine, child, "b.txt", "bb")  # step 2

    # fork_at from step 1 (inclusive) — state of steps 0-1, NOT step 2
    kids = engine.fork_at(child, step_idx=1, n=2)

    assert len(kids) == 2
    for kid in kids:
        assert kid.startswith(child + "."), f"{kid} should start with {child}"

    for kid in kids:
        ws = engine.get_workspace(kid)
        # a.txt exists with content from steps 0+1
        a_txt = ws / "a.txt"
        assert a_txt.exists(), f"{kid}: a.txt missing"
        assert a_txt.read_text() == "v1+v2", f"{kid}: wrong a.txt content"
        # step 2 file (b.txt) must NOT exist
        assert not (ws / "b.txt").exists(), f"{kid}: b.txt should not exist"

    # fork event with payload.reason == "fork_at" exists
    engine_root = tmp_path / "mv"
    events = read_events(engine_root)
    fork_at_events = [
        e
        for e in events
        if e["event"] == "fork" and e["payload"].get("reason") == "fork_at"
    ]
    assert len(fork_at_events) >= 1, "missing fork_at event"
