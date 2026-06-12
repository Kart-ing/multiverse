// Composio integration - Session-based tool execution for Multiverse branches
// Uses @composio/core SDK pattern with OpenAIAgentsProvider

export interface ComposioConfig {
  api_key: string
  base_url: string
  enabled: boolean
}

let composioConfig: ComposioConfig | null = null

export function initComposio(config: ComposioConfig) {
  composioConfig = config
  console.log(`[Composio] Initialized at ${config.base_url}`)
}

export function isComposioEnabled(): boolean {
  return composioConfig?.enabled && !!composioConfig?.api_key
}

// Wraps a tool execution through Composio's managed tool infrastructure
// Pattern: session.create() -> session.tools() -> execute
export async function composioSessionTools(userId: string): Promise<{
  sessionId: string
  tools: string[]
  execute: (tool: string, params: Record<string, unknown>) => Promise<unknown>
}> {
  if (!composioConfig?.enabled || !composioConfig.api_key) {
    return { sessionId: "local", tools: [], execute: async () => null }
  }

  try {
    // Dynamically import Composio SDK
    const { Composio } = await import("@composio/core")
    const { OpenAIAgentsProvider } = await import("@composio/openai-agents")

    const composio = new Composio({
      apiKey: composioConfig.api_key,
      provider: new OpenAIAgentsProvider(),
    })

    const session = await composio.create(userId)
    const tools = await session.tools()

    console.log(`[Composio] Session ${session.sessionId} created with ${tools.length} tools`)

    return {
      sessionId: session.sessionId,
      tools: tools.map((t: any) => t.name ?? t),
      execute: async (tool: string, params: Record<string, unknown>) => {
        const result = await session.execute(tool, params)
        return result
      },
    }
  } catch (err) {
    console.log(`[Composio] SDK unavailable, falling back to direct tool execution:`, err)
    return { sessionId: "local", tools: [], execute: async () => null }
  }
}

// Log branch tool usage for Composio analytics
export function logComposioBranch(
  sessionId: string,
  branchId: string,
  stepIndex: number,
  approach: string,
  toolsUsed: string[],
  success: boolean,
) {
  console.log(
    `[Composio::Multiverse] session=${sessionId} branch=${branchId} step=${stepIndex} ` +
    `approach="${approach}" tools=[${toolsUsed.join(",")}] success=${success}`,
  )
}

export * as Composio from "./composio"
