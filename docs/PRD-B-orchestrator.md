# PRD B — Orchestrator (Agent Loop, Fork Policy, Verifier, Benchmark)

**Project:** "Multiverse" — a speculative execution harness for AI agents. The branch predictor, but for tool calls. Agents fork into parallel sandboxed futures at uncertain decisions; a verifier picks the winner; exactly one branch's effects are atomically committed to reality; every run is deterministically replayable.

**Your role (Person B):** You own the Brain — the agent loop that runs on top of Person A's Engine, the policy that decides WHEN to fork and WHAT the branches try, the verifier that scores futures, the scheduler that keeps parallelism within budget, and the benchmark that proves speculation wins. You make the system *smart*; A makes it *safe*; C makes it *visible*.

**Hard deadline:** Single-path agent on the Engine by 1:00 PM. Speculation loop by 3:00 PM. Benchmark numbers by 4:00 PM. Feature freeze 3:30 PM (benchmark runs may continue).

---

## 1. Problem

A greedy agent commits to its first idea at every step; one bad decision sinks the task. We turn agent execution into best-first search over sandboxed futures: detect uncertain/consequential decisions, fork N alternatives, run them in parallel via the Engine, score completed futures, commit the winner. The fork policy and verifier are the intellectual core of the project.

## 2. Deliverables

1. **Agent runner.** Claude-driven tool-using loop (Anthropic API, model `claude-sonnet-4-6` for branch agents — cheap/fast; one runner instance per branch). ALL tool calls go through `engine.execute(branch_id, ...)` — never call tools directly. The runner is stateless across steps except for its message history, which is checkpointed per step so replay/fork-at works (store message history snapshots keyed by `(branch_id, step_idx)` in the branch's SQLite).
2. **Fork-point detection.** Two signals, both implemented:
   - **Self-report:** the agent's tool schema includes a required `confidence: 0-1` field on each action; fork when below threshold (start 0.6).
   - **Critic:** a single cheap LLM call ("is this decision consequential and uncertain? would a different choice plausibly succeed where this fails?") on actions touching `SPECULATABLE_WRITE` tools.
   Logprob entropy is a stretch goal if the API surface makes it easy; do NOT block on it. When forking, generate the N alternatives by asking the model for "the K most promising distinct next actions" in one call — branches must be *meaningfully different*, enforce diversity in the prompt.
3. **Scheduler.** Hard budget: max 3 live branches, max fork depth 2, max 25 steps per branch, wall-clock kill at 90s per branch. Run branches in parallel threads. Kill stragglers (`engine.squash(cause="budget_killed")`). On every fork, the parent pauses; children race; exactly one survivor continues as the parent's continuation.
4. **Verifier.** Interface: `verify(branch_id, task) -> {score: float, verdict, detail}`. Two implementations:
   - **Programmatic:** per-task checks (file exists and passes assertions, DB row correct, output matches regex/tests). Use for benchmark tasks.
   - **LLM judge fallback:** rubric prompt comparing branch outcomes for open-ended tasks.
   Emit `verifier_score` events for every branch (Person C renders these).
5. **Commit logic.** Highest passing score wins → `engine.commit(winner)`; all others squashed. If ALL branches fail, fork again from the pre-fork checkpoint with the failures summarized in-context ("these 3 approaches failed because…") — ONE retry round, then surface failure. This retry-with-failure-memory is a demo moment: the system visibly learns from its own dead timelines.
6. **Benchmark.** A suite of 6–8 tasks runnable headlessly with programmatic verifiers, e.g.: multi-step file transformation with a trap (ambiguous instruction where the obvious reading is wrong), SQLite data-cleaning task, "fix this broken config so script X runs", small web-scrape-and-summarize with a misleading page. Tasks must be HARD ENOUGH that greedy single-path fails ≥40% of the time — tune them until this is true, otherwise we have no result. Run each task 5× with speculation OFF (budget: same total LLM calls, sequential retries allowed for fairness) and 5× ON. Metrics to ClickHouse: success rate, wall-clock, total tool calls, real-world (trunk) writes. Target headline: speculation ON ≥ +30 pts success rate at comparable cost.
7. **Demo tasks.** Pick 2 tasks for the live demo: one where a branch visibly dies and the winner diverges early (theatrical), one fast crowd-pleaser. Pre-run them 5× to confirm reliability; record one good run as fallback video material for C.

## 3. Non-goals

- No sandboxing/state code — you call A's API and trust it.
- No UI — you emit events; C renders them.
- No multi-model ensembles, no RL, no training. Prompting + search only.
- No more than 3 branches / depth 2. Resist the urge.

## 4. Tech constraints

- Python 3.11+, Anthropic SDK, threads for branch parallelism.
- Every event emitted per SHARED CONTRACT (§5). C builds against this schema from a fixture file at 10:00 AM — emit a synthetic `events.jsonl` fixture for C within the first hour, before the real loop exists.

## 5. SHARED CONTRACT — Event Schema (identical across all 3 PRDs, do not change unilaterally)

```json
{
  "ts": "2026-06-12T13:05:22.123Z",
  "run_id": "run_abc",
  "event": "step | fork | branch_died | commit | run_started | run_finished | verifier_score",
  "branch_id": "b_root | b_root.1 | b_root.1.2",
  "parent_branch_id": "b_root.1",
  "step_idx": 14,
  "payload": { }
}
```

Payloads:
- `step`: `{tool, args_summary, result_summary, effect_class, latency_ms}`
- `fork`: `{children: [...], reason, entropy}`
- `branch_died`: `{cause: "verifier_rejected | error | budget_killed", detail}`
- `commit`: `{winning_branch, staged_effects_flushed}`
- `verifier_score`: `{branch_id, score, verdict: "pass|fail", detail}`

Branch IDs use dotted lineage (`b_root.2.1`).

## 6. Interfaces you consume / provide

Consume (from A): `Engine.execute / fork / squash / commit / fork_at / get_workspace / get_db_path` (see PRD-A §6).
Provide (to C): the event stream (JSONL + ClickHouse), plus a tiny control HTTP endpoint:
```
POST /run        {task_id}            -> {run_id}        # C's UI "Run" button
POST /fork_at    {branch_id, step_idx} -> {children}     # C's time-travel scrubber
GET  /tasks                            -> [task list]
```

## 7. Milestones

- **10:00** — synthetic `events.jsonl` fixture handed to C (fake but schema-perfect tree with forks/deaths/commit).
- **11:30** — single-path agent runs one task end-to-end against A's proxy (A's 11:30 build).
- **13:00** — fork/race/verify/commit loop working on one task with hardcoded fork points.
- **14:30** — confidence+critic fork detection live; retry-with-failure-memory live; control endpoint up.
- **15:30** — freeze code. **16:00** — benchmark numbers in ClickHouse; demo tasks rehearsed with C.

## 8. Acceptance tests

1. Trap task: greedy run fails ≥3/5; speculative run succeeds ≥4/5.
2. A run produces a valid event tree: every fork has ≥2 children, exactly one `commit` per run, all non-winning branches have `branch_died`.
3. `POST /fork_at` on a finished run spawns live branches that appear in the event stream within 2s.
4. All-branches-fail triggers exactly one retry round with failure summaries present in the new branches' prompts (assert via logged prompts).
