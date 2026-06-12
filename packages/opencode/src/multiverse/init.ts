import { initPioneer } from "./pioneer"
import { initLangfuse } from "./langfuse"
import { initClickHouse, createMultiverseSchema } from "./clickhouse"
import { initComposio } from "./composio"

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
      protocol: process.env.CLICKHOUSE_PROTOCOL ?? "https",
      database: process.env.CLICKHOUSE_DATABASE ?? "default",
      username: process.env.CLICKHOUSE_USERNAME ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      enabled: true,
    })
    createMultiverseSchema().catch(() => {})
    console.log("[Multiverse] ClickHouse persistence active")
  }

  if (process.env.COMPOSIO_API_KEY) {
    initComposio({
      api_key: process.env.COMPOSIO_API_KEY,
      base_url: process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev/api",
      enabled: true,
    })
    console.log("[Multiverse] Composio tool execution active")
  }

  const active = [
    process.env.PIONEER_API_KEY && "Pioneer",
    process.env.LANGFUSE_PUBLIC_KEY && "Langfuse",
    process.env.CLICKHOUSE_HOST && "ClickHouse",
    process.env.COMPOSIO_API_KEY && "Composio",
  ].filter(Boolean)

  if (active.length > 0) {
    console.log(`[Multiverse] Active sponsors: ${active.join(", ")}`)
  }

  return active
}

export * as MultiverseInit from "./init"
