export interface ClickHouseConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  protocol: string  // "http" | "https"
  enabled: boolean
}

let clickhouseConfig: ClickHouseConfig | null = null

export function initClickHouse(config: ClickHouseConfig) {
  clickhouseConfig = config
  console.log(`[ClickHouse] Initialized at ${config.protocol}://${config.host}:${config.port}/${config.database}`)
}

export function isClickHouseEnabled(): boolean {
  return clickhouseConfig?.enabled && !!clickhouseConfig?.host
}

export function getClickHouseConfig(): ClickHouseConfig | null {
  return clickhouseConfig
}

function chUrl(): string {
  const c = clickhouseConfig!
  return `${c.protocol}://${c.host}:${c.port}`
}

function btoa(str: string): string {
  return Buffer.from(str).toString("base64")
}

export async function createMultiverseSchema() {
  if (!clickhouseConfig?.enabled) return
  const db = clickhouseConfig.database

  const schema = `CREATE TABLE IF NOT EXISTS ${db}.multiverse_trees (
    session_id String,
    timestamp DateTime,
    tree_state String,
    source String DEFAULT 'multiverse',
    sponsor String DEFAULT 'clickhouse',
    INDEX session_idx (session_id) TYPE minmax GRANULARITY 1
  ) ENGINE = MergeTree()
  ORDER BY (session_id, timestamp)`

  try {
    const auth = btoa(`${clickhouseConfig.username}:${clickhouseConfig.password}`)
    await fetch(chUrl(), {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}` },
      body: schema,
    })
    console.log(`[ClickHouse] Schema created in ${db}.multiverse_trees`)
  } catch (err) {
    console.log(`[ClickHouse] Schema creation failed (may already exist):`, err)
  }
}

export async function persistTreeState(sessionId: string, tree: unknown) {
  if (!clickhouseConfig?.enabled) return
  const db = clickhouseConfig.database

  console.log(`[ClickHouse] Persisting tree state for session ${sessionId}`)

  const json = JSON.stringify(tree).replace(/'/g, "\\'")
  const query = `INSERT INTO ${db}.multiverse_trees (session_id, timestamp, tree_state, source, sponsor) VALUES ('${sessionId}', now(), '${json}', 'multiverse', 'clickhouse')`

  try {
    const auth = btoa(`${clickhouseConfig.username}:${clickhouseConfig.password}`)
    await fetch(chUrl(), {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "text/plain",
      },
      body: query,
    })
  } catch (err) {
    console.log(`[ClickHouse] Failed to persist (non-critical):`, err)
  }
}

export async function getHistoricalSessions(limit: number = 10): Promise<unknown[]> {
  if (!clickhouseConfig?.enabled) return []
  const db = clickhouseConfig.database

  const query = `SELECT session_id, timestamp, tree_state, source, sponsor FROM ${db}.multiverse_trees ORDER BY timestamp DESC LIMIT ${limit}`

  try {
    const auth = btoa(`${clickhouseConfig.username}:${clickhouseConfig.password}`)
    const response = await fetch(chUrl(), {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "text/plain",
      },
      body: query,
    })
    const text = await response.text()
    return text.trim().split("\n").slice(1).map(line => {
      const [session_id, timestamp, tree_state] = line.split("\t")
      try { return { session_id, timestamp, tree_state: JSON.parse(tree_state) } }
      catch { return { session_id, timestamp, tree_state } }
    })
  } catch {
    return []
  }
}

export * as ClickHouse from "./clickhouse"
