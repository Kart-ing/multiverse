# PRD C — Theater (Timeline Tree UI, Time-Travel Scrubber, Dashboard, Demo)

**Project:** "Multiverse" — a speculative execution harness for AI agents. The branch predictor, but for tool calls. Agents fork into parallel sandboxed futures at uncertain decisions; a verifier picks the winner; exactly one branch's effects are atomically committed to reality; every run is deterministically replayable.

**Your role (Person C):** You own everything the judges see. The system's entire story — parallel universes, dying timelines, atomic commits, rewinding a running agent — must be *legible in three seconds on a projector*. You build the live timeline-tree view, the time-travel scrubber, the benchmark dashboard, and you own the 3-minute demo script and its rehearsal. Presentation is 20% of the score and the demo is the multiplier on everything A and B build.

**Hard deadline:** Tree rendering from fixture data by 12:00. Live stream by 2:30 PM. Scrubber by 3:30 PM. Two full rehearsals before 4:30 PM submission.

---

## 1. Problem

The harness's value is invisible in a chat transcript. The UI must make three things viscerally obvious: (1) the agent is executing in PARALLEL universes, (2) bad futures DIE and never touch reality, (3) one future is COMMITTED — and we can REWIND to any past moment and fork new futures from it.

## 2. Deliverables

1. **Live Timeline Tree (the hero view).**
   - Horizontal time axis (left→right = step_idx); each branch is a lane; forks draw as a lane splitting into children; rendered from the event stream in real time.
   - Visual language (non-negotiable for projector legibility):
     - Live branches: bright, pulsing head node, current tool name as label.
     - Dead branches (`branch_died`): desaturate to gray, slight collapse, cause icon (✗ verifier / ⏱ budget / ⚠ error).
     - Committed branch (`commit`): the full root→winner path turns GOLD with an animated sweep, then visibly "merges" into a thick trunk line labeled REALITY.
   - Hover/click a node → side panel: tool, args summary, result summary, verifier detail. Click a fork node → show `reason` ("low confidence: 0.41 — trying 3 approaches").
   - Build with React + d3 (or plain SVG + d3). Tree layout from dotted branch IDs alone (`b_root.2.1` ⇒ parent `b_root.2`) — never require extra topology data.
2. **Time-Travel Scrubber (the gasp).**
   - A timeline slider over a finished (or paused) run. Dragging it left rewinds the tree: future nodes fade, the world-state panel shows the workspace file listing at that step (from A's replay via B's endpoints).
   - A "FORK FROM HERE" button on any past node → calls `POST /fork_at {branch_id, step_idx}` → new live branches sprout from the PAST node in front of the audience while the old future is still on screen, grayed.
   - This must feel like scrubbing video. Smoothness > features.
3. **Benchmark Dashboard.** One screen, two big numbers: success rate Speculation OFF vs ON (e.g., 35% → 85%), plus bars for wall-clock and real-world writes. Reads from ClickHouse `events` table + B's benchmark results table. No exploratory BI — this is a single rehearsed slide that happens to be live.
4. **Ingest layer.** Tail `events.jsonl` and/or subscribe to B's stream; maintain run state in memory; push to the browser over WebSocket/SSE. Handle out-of-order and duplicate events gracefully (idempotent by `(run_id, branch_id, step_idx, event)`).
5. **Demo script + fallback.** You own the 3 minutes:
   - 0:00–0:30 — the claim: "Agents commit to every mistake. CPUs solved this in the 90s: speculate, verify, commit. We built that harness for agents."
   - 0:30–1:30 — live run of B's theatrical task: forks sprout, a branch dies on screen ("that universe sent the wrong file — it never happened"), winner goes gold and merges.
   - 1:30–2:15 — time travel: rewind the run, fork an alternate future from the past, let it win.
   - 2:15–3:00 — dashboard: OFF vs ON numbers; close with "the model stayed the same — the harness made it reliable."
   - Record a full good run by 3:45 as video fallback; the scrubber demo can run on recorded event data if the network dies. Rehearse twice, timed.

## 3. Non-goals

- No auth, no multi-user, no persistence beyond the event log, no mobile.
- No editing of agent prompts/config from the UI. Two controls only: Run task, Fork-from-here.
- Do not invent extra event fields — if you need data, negotiate the SHARED CONTRACT with A and B at a sync, never unilaterally.

## 4. Tech constraints

- React + Vite, d3 for layout, WebSocket/SSE from a tiny Node or Python relay. OpenUI components where they fit (sponsor criterion) — but the tree itself is custom SVG.
- Dark theme, high contrast, minimum 16px labels — projector-first. Test by standing 4 meters from your laptop.
- Start from B's synthetic `events.jsonl` fixture (available 10:00). You must be fully buildable WITHOUT A or B's real systems running.

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

## 6. Interfaces you consume

- Event stream: `events.jsonl` tail + ClickHouse `events` table (A and B both insert).
- Control API (from B): `POST /run {task_id}`, `POST /fork_at {branch_id, step_idx}`, `GET /tasks`.
- Replay state (via B, backed by A): workspace file listing at `(branch_id, step_idx)` for the world-state panel — agree on the exact endpoint shape with B at the 1:30 sync; until then, stub it.

## 7. Milestones

- **10:30** — ingest + static tree renders B's fixture file.
- **12:00** — animated tree: forks, deaths, gold commit sweep, all from fixture replayed at 2× speed.
- **14:30** — live: real run from B streams into the tree end-to-end.
- **15:30** — scrubber + fork-from-here working; dashboard reading real ClickHouse data.
- **15:45** — fallback recording captured. **16:00 & 16:15** — two timed rehearsals. **16:30** — submit (you also own the Devpost submission + 3-min recording upload).

## 8. Acceptance tests

1. Replaying the fixture at 2× produces a correct tree: every fork splits visibly, exactly one gold path per run, dead branches gray with cause icons.
2. Duplicate/out-of-order events do not corrupt the tree.
3. From 4 meters away, a stranger can answer: "how many universes ran? which one became real? why did that one die?"
4. Scrubber: rewind a finished run, fork from a mid-run node, see new live branches appear within 2 seconds.
5. Full demo runs in ≤ 3:00 twice in a row without improvisation.
