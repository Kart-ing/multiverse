# Sponsor Integrations

## Composio (composio.dev) — Tool Execution
**Prize**: Best Agent Execution - $200 Amazon gift card

**Integration**: All Multiverse branch tool calls route through Composio's managed tool execution platform. Each branch's tool calls (bash, file I/O, code editing) are wrapped with Composio for:
- Reliable retry on transient failures
- Tool auth management
- Execution tracing per branch

**Activation**: Set `COMPOSIO_API_KEY` environment variable.
**Fallback**: Gracefully falls back to direct execution when Composio is unavailable.

## Langfuse (langfuse.com) — LLM Observability & Tracing
**Prize**: Most impressive use of Langfuse (bonus $350)

**Integration**: Every branch execution in the Multiverse decision tree is traced via Langfuse for full observability:
- **Session traces**: `traceSessionStart` / `traceSessionComplete` capture the full session lifecycle
- **Branch traces**: `traceBranchExecution` records each approach attempt with input, output, score, tool calls, and success/failure status
- **Step traces**: `traceStepComplete` records which branch won each planning step with all scores

**Tracing data model**: Langfuse ingestion API (`/api/public/ingestion`) — each trace includes metadata tagged with `source: "multiverse"` and `sponsor: "langfuse"`.

**Activation**: Set `LANGfuse_PUBLIC_KEY`, `LANGfuse_SECRET_KEY`, and `LANGfuse_BASE_URL` (or call `initLangfuse()` programmatically).
**Fallback**: Silently drops traces when Langfuse is unreachable — never blocks execution.

**Module**: `packages/opencode/src/multiverse/langfuse.ts`

## ClickHouse (clickhouse.com) — Tree State Persistence
**Prize**: ClickHouse Best Use — $1,600 cash + credits

**Integration**: Full Multiverse decision tree state is persisted to ClickHouse for historical analysis and replay:
- **Tree snapshots**: `persistTreeState` writes the complete `MultiverseTree` as JSON to `multiverse_trees` on every step advancement, branch failure, and session end
- **Schema management**: `createMultiverseSchema` sets up the MergeTree table with session-level indexing
- **Historical queries**: `getHistoricalSessions` retrieves past sessions for analysis/replay

**Schema**: `multiverse_trees` — `session_id String`, `timestamp DateTime`, `tree_state String`, `source String`, `sponsor String`. Ordered by `(session_id, timestamp)` with `minmax` index on `session_id`.

**Activation**: Set `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` (or call `initClickHouse()` programmatically).
**Fallback**: Prints non-critical warning when ClickHouse is unreachable — never blocks execution.

**Module**: `packages/opencode/src/multiverse/clickhouse.ts`

## Pioneer (pioneer.com) — Inference
**Prize**: Best Use of Pioneer — $500 cash

**Integration**: Branch exploration LLM calls route through Pioneer's inference API for cost-effective parallel execution across 5 branches per step.
