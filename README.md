# 🌌 Multiverse

**A speculative execution harness for AI agents. The branch predictor, but for tool calls.**

Agents fork into parallel sandboxed futures at uncertain decisions; a verifier picks the winner; exactly one branch's effects are atomically committed to reality; every run is deterministically replayable.

> Hackathon project — built in a day. ⏱️

---

## The idea

Agents execute tool calls with immediate, irreversible effect. If an agent guesses wrong, you've already sent the email, written the file, hit the API.

Multiverse intercepts **every** effect. At any uncertain decision point, the agent **forks** into N parallel futures, each running against an isolated copy of world state. A verifier scores the branches, **one winner is committed** atomically to reality, and the losers are discarded. Because every tool result is logged, any run is **deterministically replayable** — enabling rewind, time-travel debugging, and "fork from the past."

```
                    ┌─ b_root.1  (sandbox) ─ squashed ✗
   b_root ──fork──> ├─ b_root.2  (sandbox) ─ COMMIT ✓ ──> new trunk
                    └─ b_root.3  (sandbox) ─ squashed ✗
```

## Architecture

The system is three layers, built by three people against one shared event contract:

| Layer | Owner | Responsibility |
|-------|-------|----------------|
| **Engine** | Person A | Forking, isolation, atomic commit, record/replay. Makes speculation *safe*. ← this repo's core |
| **Orchestrator** | Person B | The agent loop, LLM calls, fork-decision logic. |
| **UI / Observability** | Person C | Renders the branch tree, time scrubber, event stream. |

This repo holds the **Engine** — the layer that makes speculation safe. Nothing an agent does touches the real world directly; everything routes through `engine.execute()`.

### Effect classification

Every tool is registered with an effect class:

- **`READ`** — passes through, result recorded.
- **`SPECULATABLE_WRITE`** — applied only to the branch's sandbox (filesystem, SQLite).
- **`IRREVERSIBLE`** — refused inside speculative branches; only allowed on the committed trunk (e.g., sending a real email).

### Sandboxing (copy-on-write world state)

- **Filesystem** — each branch gets its own workdir (cheap directory copy of the trunk on fork).
- **SQLite** — each branch gets its own copy of the trunk `.db` file. (We standardize on SQLite so DB branching = file copy.)
- **HTTP** — side-effecting requests are staged into a per-branch log instead of sent; safe GETs pass through with response recording.

## Engine API

```python
from multiverse import Engine

engine = Engine(workspace="./trunk")
engine.register_tool("write_file", write_file_fn, effect_class="SPECULATABLE_WRITE")
engine.register_tool("send_email", send_email_fn, effect_class="IRREVERSIBLE")

# Fork into 3 parallel futures
b1, b2, b3 = engine.fork("b_root", n=3, reason="uncertain next action")

# Every tool call routes through the engine, scoped to a branch
engine.execute(b1, "write_file", {"path": "answer.txt", "content": "A"})
engine.execute(b2, "write_file", {"path": "answer.txt", "content": "B"})

# Verifier picks b2 — commit it, discard the rest
engine.commit(b2)          # b2's sandbox atomically becomes the new trunk
engine.squash(b1, cause="verifier_rejected")
engine.squash(b3, cause="verifier_rejected")

# Time-travel: replay a branch, or fork from the past
engine.replay(b2, until_step=5)
new_branches = engine.fork_at(b2, step_idx=3, n=2)
```

### Surface

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

## Event contract

Every state transition emits a JSON event to an append-only `events.jsonl` stream (and optionally a downstream ingest endpoint). Branch IDs use **dotted lineage** (`b_root.2.1`) so the tree can be rendered from IDs alone.

```json
{
  "ts": "2026-06-12T13:05:22.123Z",
  "run_id": "run_abc",
  "event": "step | fork | branch_died | commit | run_started | run_finished | verifier_score",
  "branch_id": "b_root.1.2",
  "parent_branch_id": "b_root.1",
  "step_idx": 14,
  "payload": { }
}
```

See [`docs/PRD-A-engine.md`](docs/PRD-A-engine.md) for the full specification.

## Getting started

```bash
git clone https://github.com/<owner>/multiverse.git
cd multiverse
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

> Requires Python 3.11+. Stdlib + minimal deps. SQLite for DB state, JSONL for the log.

## Status

🚧 **Hackathon in progress.** See the [PRD](docs/PRD-A-engine.md) for milestones and acceptance tests.

## License

[MIT](LICENSE)
