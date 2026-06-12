import { initPioneer } from "./pioneer"
import { initLangfuse } from "./langfuse"
import { initClickHouse, createMultiverseSchema } from "./clickhouse"

export function initSponsorIntegrations() {
  if (process.env.PIONEER_API_KEY) {
    initPioneer({
      api_key: process.env.PIONEER_API_KEY,
      base_url: process.env.PIONEER_BASE_URL ?? "https://api.pioneer.com/v1",
      model: process.env.PIONEER_MODEL ?? "pioneer-pro",
      enabled: true,
    })
    console.log("[Multiverse] Pioneer integration active")
  }

  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    initLangfuse({
      public_key: process.env.LANGFUSE_PUBLIC_KEY,
      secret_key: process.env.LANGFUSE_SECRET_KEY,
      base_url: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
      enabled: true,
    })
    console.log("[Multiverse] Langfuse tracing active")
  }

  if (process.env.CLICKHOUSE_HOST) {
    initClickHouse({
      host: process.env.CLICKHOUSE_HOST,
      port: Number(process.env.CLICKHOUSE_PORT) || 8123,
      database: process.env.CLICKHOUSE_DATABASE ?? "multiverse",
      username: process.env.CLICKHOUSE_USERNAME ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      enabled: true,
    })
    createMultiverseSchema().catch(() => {})
    console.log("[Multiverse] ClickHouse persistence active")
  }

  const active = [
    process.env.PIONEER_API_KEY && "Pioneer",
    process.env.LANGFUSE_PUBLIC_KEY && "Langfuse",
    process.env.CLICKHOUSE_HOST && "ClickHouse",
  ].filter(Boolean)

  if (active.length > 0) {
    console.log(`[Multiverse] Active sponsors: ${active.join(", ")}`)
  }

  return active
}

export * as MultiverseInit from "./init"
