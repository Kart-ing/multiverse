export interface LangfuseConfig {
  public_key: string
  secret_key: string
  base_url: string
  enabled: boolean
}

let langfuseConfig: LangfuseConfig | null = null

export function initLangfuse(config: LangfuseConfig) {
  langfuseConfig = config
  console.log(`[Langfuse] Initialized tracing at ${config.base_url}`)
}

export function isLangfuseEnabled(): boolean {
  return langfuseConfig?.enabled && !!langfuseConfig?.public_key
}

function btoa(str: string): string {
  return Buffer.from(str).toString("base64")
}

async function sendSpan(data: Record<string, unknown>) {
  if (!langfuseConfig?.enabled) return
  try {
    const auth = btoa(`${langfuseConfig.public_key}:${langfuseConfig.secret_key}`)
    await fetch(`${langfuseConfig.base_url}/api/public/ingestion`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch: [data] }),
    })
  } catch {
    // Silently drop if Langfuse unavailable
  }
}

export function traceSessionStart(sessionId: string, task: string, planLength: number) {
  console.log(`[Langfuse] Trace: session ${sessionId} started (${planLength} steps)`)
  void sendSpan({
    id: `session-${sessionId}`,
    type: "trace-create",
    body: {
      name: "Multiverse Session",
      metadata: { sessionId, task, planLength, type: "session_start", sponsor: "langfuse" },
      input: { task },
      timestamp: new Date().toISOString(),
    },
  })
}

export function traceBranchExecution(
  sessionId: string,
  stepIndex: number,
  branchIndex: number,
  approach: string,
  success: boolean,
  score: number,
  toolCalls: string[],
  result: string,
) {
  const traceId = `branch-${sessionId}-s${stepIndex}-b${branchIndex}`
  console.log(`[Langfuse] Trace: ${traceId} ${approach} score=${score} success=${success}`)
  void sendSpan({
    id: traceId,
    type: "trace-create",
    body: {
      name: `Step ${stepIndex} Branch ${branchIndex}: ${approach}`,
      metadata: {
        sessionId, stepIndex, branchIndex, approach, success, score,
        toolCalls, type: "branch_execution", sponsor: "langfuse",
      },
      input: { approach, stepIndex },
      output: { success, score, result: result.slice(0, 500) },
      statusMessage: success ? `Score: ${score}/100` : `Failed: ${result.slice(0, 200)}`,
      timestamp: new Date().toISOString(),
    },
  })
}

export function traceStepComplete(
  sessionId: string,
  stepIndex: number,
  winnerBranchIndex: number,
  winnerApproach: string,
  allScores: number[],
) {
  console.log(`[Langfuse] Trace: step ${stepIndex} complete → winner: ${winnerApproach} (${allScores[winnerBranchIndex]}/100)`)
  void sendSpan({
    id: `step-${sessionId}-s${stepIndex}`,
    type: "trace-create",
    body: {
      name: `Step ${stepIndex} Complete`,
      metadata: { sessionId, stepIndex, winnerBranchIndex, winnerApproach, allScores, type: "step_complete" },
      output: { winner: winnerApproach, winnerScore: allScores[winnerBranchIndex], allScores },
      statusMessage: `Winner: ${winnerApproach} (${allScores[winnerBranchIndex]}/100)`,
      timestamp: new Date().toISOString(),
    },
  })
}

export function traceSessionComplete(sessionId: string, totalSteps: number, completedSteps: number, tree: unknown) {
  console.log(`[Langfuse] Trace: session ${sessionId} complete (${completedSteps}/${totalSteps} steps)`)
  void sendSpan({
    id: `session-${sessionId}-complete`,
    type: "trace-create",
    body: {
      name: "Multiverse Session Complete",
      metadata: { sessionId, totalSteps, completedSteps, type: "session_complete", tree },
      output: { totalSteps, completedSteps },
      statusMessage: `${completedSteps}/${totalSteps} steps completed`,
      timestamp: new Date().toISOString(),
    },
  })
}

export * as Langfuse from "./langfuse"
