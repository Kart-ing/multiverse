import { Effect, Schema } from "effect"

export class ComposioConfig extends Schema.Class<ComposioConfig>("ComposioConfig")({
  api_key: Schema.optional(Schema.String),
  base_url: Schema.optionalWith(Schema.String, { default: () => "https://backend.composio.dev/api" }),
  enabled: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

export interface ToolExecution {
  tool: string
  params: Record<string, unknown>
  branch_id: string
  step_index: number
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  composio_execution_id?: string
  latency_ms: number
}

const TOOL_MAP: Record<string, string> = {
  "bash": "BASH_EXEC",
  "file_read": "FILE_READ",
  "file_write": "FILE_WRITE",
  "glob": "FILE_SEARCH",
  "grep": "FILE_GREP",
  "edit": "FILE_EDIT",
  "write": "FILE_WRITE",
}

export function wrapToolCall(tool: string, params: Record<string, unknown>, branchId: string, stepIndex: number): ToolExecution {
  return {
    tool: TOOL_MAP[tool] ?? tool.toUpperCase(),
    params,
    branch_id: branchId,
    step_index: stepIndex,
  }
}

export async function executeViaComposio(exec: ToolExecution, config: ComposioConfig, directExecutor: (t: ToolExecution) => Promise<ToolResult>): Promise<ToolResult> {
  if (!config.enabled || !config.api_key) {
    return directExecutor(exec)
  }

  const start = Date.now()
  try {
    const response = await fetch(`${config.base_url}/v1/actions/${exec.tool}/execute`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.api_key}`,
        "Content-Type": "application/json",
        "X-Composio-Branch-Id": exec.branch_id,
        "X-Composio-Step-Index": String(exec.step_index),
      },
      body: JSON.stringify({
        params: exec.params,
        metadata: {
          source: "multiverse",
          branch_id: exec.branch_id,
          step_index: exec.step_index,
        },
      }),
    })

    const data = await response.json() as any
    const latency = Date.now() - start

    if (!response.ok) {
      console.log(`[Composio] Tool ${exec.tool} failed, falling back to direct execution`)
      return directExecutor(exec)
    }

    return {
      success: data.success ?? true,
      output: data.output ?? data.result ?? JSON.stringify(data),
      composio_execution_id: data.execution_id,
      latency_ms: latency,
    }
  } catch (err) {
    console.log(`[Composio] Composio unavailable, using direct execution:`, err)
    return directExecutor(exec)
  }
}

export function logBranchExecution(
  branchId: string,
  stepIndex: number,
  approach: string,
  toolsUsed: string[],
  success: boolean,
  score: number,
) {
  console.log(`[Composio::Multiverse] branch=${branchId} step=${stepIndex} approach="${approach}" tools=[${toolsUsed.join(",")}] success=${success} score=${score}`)
}

export * as Composio from "./composio"
