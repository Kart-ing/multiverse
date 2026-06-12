# PRD A — Speculation Engine (State, Effects, Replay)

**Project:** "Multiverse" — a speculative execution harness for AI agents. The branch predictor, but for tool calls. Agents fork into parallel sandboxed futures at uncertain decisions; a verifier picks the winner; exactly one branch's effects are atomically committed to reality; every run is deterministically replayable.

**Your role (Person A):** You own the Engine — the layer that makes speculation *safe*. Nothing an agent does touches the real world directly; everything routes through you. You provide forking, isolation, atomic commit, and record/replay as a library that Person B's orchestrator calls. You have ZERO UI work and ZERO LLM prompting work.

**Hard deadline:** Engine API working end-to-end by 2:00 PM. Feature freeze 3:30 PM.

---

## 1. Problem

Agents execute tool calls with immediate, irreversible effect. To run N alternative futures in parallel, every effect must be intercepted and staged against an isolated copy of world state, then either committed (one winner) or discarded (all losers). Additionally, any past execution must be reproducible exactly, so the UI can offer rewind/re-fork.

## 2. Deliverables

1. **Tool-call proxy.** A single Python entry point `engine.execute(branch_id, tool_name, args) -> result`. Every agent tool call goes through it. No tool may be invoked any other way.
2. **Effect classification.** Each tool is registered with a class:
   - `READ` — passes through, result recorded.
   - `SPECULATABLE_WRITE` — applied only to the branch's sandbox.
   - `IRREVERSIBLE` — refused inside speculative branches; only allowed on the committed trunk (e.g., sending a real email). Return a typed error the orchestrator can handle.
3. **Branch sandboxes (copy-on-write world state).**
   - Filesystem: each branch gets its own workdir. Implement as cheap directory copy (`cp -r --reflink=auto` or plain copy) of the trunk workspace on fork. OverlayFS is a stretch goal, NOT the day-one plan — naive copy of a small workspace is fine and debuggable.
   - SQLite DB: each branch gets its own copy of the trunk `.db` file on fork. (We standardize on SQLite precisely so DB branching = file copy.)
   - HTTP effects: staged. Speculative branches record outbound side-effecting requests into a per-branch staging log instead of sending; GETs to safe domains pass through with response recording.
4. **Fork / commit / squash API.**
   ```python
   branch_id = engine.fork(parent_branch_id)          # CoW snapshot, O(workspace size)
   engine.squash(branch_id)                            # delete sandbox, mark dead
   engine.commit(branch_id)                            # branch sandbox becomes the new trunk:
                                                       # swap workdir + db atomically, flush staged
                                                       # HTTP effects for real, emit commit event
   ```
   Commit must be atomic from the orchestrator's point of view: rename-swap directories, single lock.
5. **Record/replay log.** Every `execute()` appends a record: `{run_id, branch_id, step_idx, tool, args, result, wall_time, parent_step}`. Replay mode: `engine.replay(branch_id, until_step)` reconstructs that branch's sandbox by re-applying recorded results WITHOUT re-calling tools (deterministic by construction — tool results come from the log, not the world). This powers the UI's time scrubber and "fork from the past": `engine.fork_at(branch_id, step_idx)` = replay to step, then fork.
6. **Event emission.** Emit every state transition as a JSON event (schema in §5) to a local event bus: append-only JSONL file `events.jsonl` + optional POST to Person C's ingest endpoint and ClickHouse insert. Events are fire-and-forget; engine never blocks on the UI.

## 3. Non-goals (do not build)

- No agent loop, no LLM calls, no fork-decision logic (Person B).
- No UI of any kind (Person C).
- No Postgres/MySQL branching, no container-per-branch, no OverlayFS unless everything else is done.
- No multi-machine distribution. One box, threads/processes.

## 4. Tech constraints

- Python 3.11+, stdlib + minimal deps. SQLite for DB state. JSONL for the log.
- Concurrency: branches may execute in parallel threads/processes; the engine must be thread-safe around fork/commit (one global lock on commit is acceptable).
- Workspace assumed small (< 50 MB) so copy-on-fork is instant. Enforce/assume this.

## 5. SHARED CONTRACT — Event Schema (identical across all 3 PRDs, do not change unilaterally)

All events are JSON objects on one JSONL stream and inserted into ClickHouse table `events`.

```json
{
  "ts": "2026-06-12T13:05:22.123Z",      // ISO8601, required
  "run_id": "run_abc",                    // one task execution = one run
  "event": "step | fork | branch_died | commit | run_started | run_finished | verifier_score",
  "branch_id": "b_root | b_root.1 | b_root.1.2",   // dotted lineage encodes the tree
  "parent_branch_id": "b_root.1",         // null for root
  "step_idx": 14,                         // monotonically increasing per branch
  "payload": { }                          // event-specific, see below
}
```

Payloads:
- `step`: `{tool, args_summary, result_summary, effect_class, latency_ms}`
- `fork`: `{children: ["b_root.1","b_root.2","b_root.3"], reason, entropy}`
- `branch_died`: `{cause: "verifier_rejected | error | budget_killed", detail}`
- `commit`: `{winning_branch, staged_effects_flushed}`
- `verifier_score`: `{branch_id, score, verdict: "pass|fail", detail}`

Branch IDs use dotted lineage (`b_root.2.1`) so Person C can render the tree from IDs alone.

## 6. Engine API surface (what Person B imports)

```python
class Engine:
    def register_tool(self, name, fn, effect_class): ...
    def execute(self, branch_id, tool_name, args) -> ToolResult: ...
    def fork(self, parent_branch_id, n=1, reason="", entropy=None) -> list[str]: ...
    def squash(self, branch_id, cause, detail=""): ...
    def commit(self, branch_id): ...
    def fork_at(self, branch_id, step_idx, n=1) -> list[str]: ...   # time-travel fork
    def get_workspace(self, branch_id) -> Path: ...
    def get_db_path(self, branch_id) -> Path: ...
```

## 7. Milestones

- **11:30** — proxy + READ/WRITE classification + per-branch workdir fork working; unit test: two branches write different files, don't see each other.
- **12:30** — SQLite branching + atomic commit (workdir swap) working; test: fork 3, commit 1, trunk reflects winner only.
- **14:00** — replay + `fork_at` working; events flowing to JSONL + ClickHouse. **Hand integration build to B and C.**
- **15:30** — freeze. Help B with integration bugs; stress test 3 parallel branches × 10 steps.

## 8. Acceptance tests (write these first)

1. Fork 3 branches; each writes `answer.txt` with a different value; trunk has none; commit branch 2; trunk's `answer.txt` == branch 2's value; branches 1,3 sandboxes deleted.
2. IRREVERSIBLE tool called in a speculative branch returns `IrreversibleInSpeculationError`, branch survives, event emitted.
3. Replay branch to step k yields byte-identical workspace to original at step k.
4. `events.jsonl` parses and every branch_id's lineage is consistent (parent prefix).
