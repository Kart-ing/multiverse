# ClickHouse setup (shared `events` table)

One local ClickHouse serves all three components: the Engine and Orchestrator insert events; the Theater dashboard queries them. This is our "Best Use of ClickHouse" sponsor integration — make sure the demo runs with it enabled.

## 1. Start the server (one person's machine, LAN-reachable)

```bash
docker run -d --name multiverse-clickhouse \
  -p 8123:8123 -p 9000:9000 \
  -e CLICKHOUSE_PASSWORD=multiverse \
  clickhouse/clickhouse-server

curl -s http://localhost:8123/ping   # → Ok.
```

## 2. Create the events table (once)

```bash
echo "CREATE TABLE IF NOT EXISTS events (
    ts String,
    run_id String,
    event String,
    branch_id String,
    parent_branch_id Nullable(String),
    step_idx Int64,
    payload String
) ENGINE = MergeTree ORDER BY (run_id, branch_id, step_idx)" \
  | curl -s "http://default:multiverse@localhost:8123/" --data-binary @-
```

`ts` is the ISO8601 string from the shared contract — parse in queries with
`parseDateTime64BestEffort(ts)` if you need time math. `payload` is the event's
JSON payload as a string — use `JSONExtractString(payload, 'tool')` etc.

## 3. Point the Engine at it (Person A / B)

```python
engine = Engine(
    root=".multiverse",
    clickhouse={
        "host": "localhost",        # or the host machine's LAN IP
        "port": 8123,
        "username": "default",
        "password": "multiverse",
        "database": "default",
        "table": "events",
    },
)
```

Delivery is fire-and-forget on a background thread — a dead/missing server can
never block or crash a run (tested). Call `engine.close()` at run end to drain
the insert queue.

## 4. Useful queries (Person C's dashboard)

```sql
-- the live tree for a run
SELECT event, branch_id, parent_branch_id, step_idx, payload
FROM events WHERE run_id = {run_id:String} ORDER BY ts;

-- benchmark headline: success rate by mode (B tags runs in payload)
SELECT JSONExtractString(payload, 'detail') AS detail, count()
FROM events WHERE event = 'run_finished' GROUP BY detail;

-- branch death causes
SELECT JSONExtractString(payload, 'cause') AS cause, count()
FROM events WHERE event = 'branch_died' GROUP BY cause;
```

Verified end-to-end 2026-06-12: a full engine scenario (fork 3 → steps →
irreversible refusal → commit → finish) landed all events in the table with
correct lineage ordering.
