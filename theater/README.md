# Multiverse Theater

PRD C lives under this directory so Engine and Orchestrator work can continue in `src/` and `docs/PRD-B-orchestrator.md` without file conflicts.

## Run

```bash
cd theater
npm start
```

Open `http://localhost:4173`.

By default, the relay tries B at `http://localhost:8787` and falls back to local fixture mode if B is not running.

PowerShell integration example:

```powershell
$env:B_CONTROL_URL = "http://localhost:8787"
$env:EVENTS_JSONL = "C:\path\to\events.jsonl"
npm start
```

## Demo Hooks

The browser UI includes stable `data-autogui` attributes for sponsor/demo automation:

- `run-task`
- `timeline-svg`
- `time-scrubber`
- `fork-from-here`
- `benchmark-dashboard`

The relay is dependency-free Node and supports:

- `GET /events` SSE replay/tail of `fixtures/events.jsonl` or `$env:EVENTS_JSONL`
- `GET /api/events`
- `GET /api/tasks` -> proxies B `GET /tasks`
- `POST /api/run` -> proxies B `POST /run` with `{ task_id, speculation }`
- `POST /api/fork_at` -> proxies B `POST /fork_at` with `{ branch_id, step_idx, n }`
- `POST /api/world_state` -> proxies B replay state once available; fixture fallback is read-only
- `GET /api/benchmarks`

Legacy `/tasks`, `/run`, and `/fork_at` aliases remain for quick manual checks, but browser code uses `/api/*`.
