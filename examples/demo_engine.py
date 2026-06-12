"""demo_engine.py — Integration walkthrough for the Multiverse Engine.

Run:
    pip install -e . && python3 examples/demo_engine.py
    # or
    PYTHONPATH=src python3 examples/demo_engine.py

Person B: your agent loop maps to this API like so —
  - Every LLM tool call → engine.execute(branch_id, tool, args)
  - On low confidence (or critic says "fork here") → engine.fork(branch_id, n=N)
  - On branch completion → verifier scores branches → engine.commit(winner)
  - Losers auto-squashed by commit; or engine.squash(loser, cause="verifier_rejected")
"""

import json, shutil, sqlite3, sys, tempfile
from pathlib import Path
from multiverse import Engine, EffectClass, IrreversibleInSpeculationError


def _setup(tempdir):
    root = Path(tempdir)
    engine = Engine(root=root, run_id="run_demo")

    def write_file(ctx, args):
        (ctx.workspace / args["path"]).write_text(args["content"])
        return f"wrote {args['path']}"

    def read_file(ctx, args):
        p = ctx.workspace / args["path"]
        return p.read_text() if p.exists() else None

    def query_db(ctx, args):
        c = sqlite3.connect(str(ctx.db_path))
        c.execute("CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, label TEXT)")
        n = c.execute("SELECT COUNT(*) FROM records").fetchone()[0]
        c.close()
        return n

    def save_record(ctx, args):
        c = sqlite3.connect(str(ctx.db_path))
        c.execute("INSERT INTO records (label) VALUES (?)", (args["label"],))
        c.commit(); c.close()
        return f"inserted {args['label']}"

    def send_email(ctx, args):
        return f"sent email to {args['to']} (engine stops this in speculation)"

    engine.register_tool("write_file", write_file, EffectClass.SPECULATABLE_WRITE)
    engine.register_tool("read_file",  read_file,  EffectClass.READ)
    engine.register_tool("query_db",   query_db,   EffectClass.READ)
    engine.register_tool("save_record",save_record,EffectClass.SPECULATABLE_WRITE)
    engine.register_tool("send_email", send_email, EffectClass.IRREVERSIBLE)
    return engine


def main():
    tmp = tempfile.mkdtemp(prefix="multiverse_demo_")
    try:
        engine = _setup(tmp)
        trunk = "b_root"

        # 1: Fork on low confidence
        print("=" * 64)
        print("STEP 1 — Fork: agent at an uncertain decision")
        print("=" * 64)
        kids = engine.fork(trunk, n=3, reason="confidence 0.41 — trying 3 approaches")
        print(f"  Forked {trunk} → {kids}\n")

        # 2: Branch isolation — files & DB
        print("STEP 2 — Branch isolation: each writes answer.txt + DB row")
        print("-" * 56)
        for k in kids:
            engine.execute(k, "write_file", {"path": "answer.txt", "content": f"Answer from {k}"})
            engine.execute(k, "save_record", {"label": f"row-from-{k}"})
            a = engine.execute(k, "read_file", {"path": "answer.txt"})
            d = engine.execute(k, "query_db", {})
            print(f"  [{k}] answer.txt = {a.value!r}  |  DB rows = {d.value}")
        ta = engine.execute(trunk, "read_file", {"path": "answer.txt"})
        td = engine.execute(trunk, "query_db", {})
        print(f"  [trunk] answer.txt = {ta.value!r}  |  DB rows = {td.value}\n")

        # 3: IRREVERSIBLE refused in speculation
        print("STEP 3 — IRREVERSIBLE tool attempted in speculative branch")
        print("-" * 54)
        try:
            engine.execute(kids[0], "send_email", {"to": "boss@example.com"})
        except IrreversibleInSpeculationError:
            print(f"  ⛔ universe {kids[0]} tried an irreversible action — refused, branch survives\n")

        # 4: Verifier picks branch 2 → commit
        print("STEP 4 — Verifier: branch 2 wins → commit")
        print("-" * 40)
        winner = kids[1]
        engine.commit(winner)
        ta = engine.execute(trunk, "read_file", {"path": "answer.txt"})
        td = engine.execute(trunk, "query_db", {})
        print(f"  Committed {winner}")
        print(f"  [trunk] answer.txt = {ta.value!r}  |  DB rows = {td.value}\n")

        # 5: Time-travel fork
        print("STEP 5 — Time travel: fork_at from step 0")
        print("-" * 40)
        past = engine.fork_at(winner, step_idx=0, n=1)
        print(f"  fork_at({winner}, step_idx=0) → {past}")
        pa = engine.execute(past[0], "read_file", {"path": "answer.txt"})
        pd = engine.execute(past[0], "query_db", {})
        print(f"  [{past[0]}] answer.txt = {pa.value!r}  |  DB rows = {pd.value}")
        print("  (replay is inclusive: step 0's write applied, the later DB insert is not)\n")

        # 6: Finish + event log tail
        print("STEP 6 — finish_run() + events.jsonl tail")
        print("-" * 38)
        engine.finish_run()
        events = [ln for ln in Path(tmp, "events.jsonl").read_text().strip().splitlines() if ln]
        print(f"  events.jsonl — {len(events)} total events")
        print("  Last ~10 events (what Person C's UI renders):")
        for line in events[-10:]:
            ev = json.loads(line)
            print(f"    {ev['event']:15s}  branch={ev['branch_id']:14s}  "
                  f"payload={json.dumps(ev.get('payload',{}))}")

        jp = Path(tmp, "journal.jsonl")
        if jp.exists():
            jl = [ln for ln in jp.read_text().strip().splitlines() if ln]
            print(f"\n  journal.jsonl — {len(jl)} records")
        print()

        engine.close()
        print("✓ Demo complete.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
