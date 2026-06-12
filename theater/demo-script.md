# Multiverse Theater Demo Script

Target: 3 minutes. Keep the browser on `http://localhost:4173`.

## 0:00-0:30 Claim

"Agents commit to every mistake. CPUs solved this in the 90s: speculate, verify, commit. We built that harness for agents."

Point at the empty/live tree and name the three signals judges need to see: parallel futures, dead timelines, committed reality.

## 0:30-1:30 Live Run

Click `Run Task`.

Narration:

"The same model is now trying three futures in isolated sandboxes. This branch picked the stale draft. It dies here. That universe never touched the real workspace. The winner turns gold, flushes one staged effect, and merges into REALITY."

Pause on the gold path long enough for the room to read the dead causes and winner.

## 1:30-2:15 Time Travel

Drag the scrubber back to a mid-run fork or step on `b_root.2`.

Click `Fork From Here`.

Narration:

"Because every tool result is logged, we can scrub the run like video. Now we fork from the past while the old future remains visible. The alternate future races forward and commits from that earlier moment."

## 2:15-3:00 Dashboard

Scroll or point to the benchmark dashboard.

Narration:

"The model stayed the same. The harness made it reliable: speculation off succeeds 35 percent; speculation on succeeds 85 percent, with fewer real-world writes because bad futures die before reality."

Close:

"This is branch prediction for agents: speculate, verify, commit."

## Fallback

If B's live stream is down, use the fixture replay and the local stub controls. C still calls `/api/run`, `/api/fork_at`, and `/api/world_state`; the relay falls back locally if `B_CONTROL_URL` is unavailable. If ClickHouse is down, the dashboard reads `fixture` numbers from `/api/benchmarks`; do not leave the theater screen.
