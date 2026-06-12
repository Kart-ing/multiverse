import { decomposeTask } from "./planner"
import { generateApproaches } from "./explorer"
import { verifyResult } from "./verifier"
import { initTree, updateTree, getTreeState, clearTree } from "./tree-state"
import { logBranchExecution } from "./composio"

export interface MultiverseConfig {
  enabled: boolean
  max_branches: number
  max_depth: number
  auto_allow_permissions: boolean
  verbose_logging: boolean
}

export interface MultiverseSession {
  config: MultiverseConfig
  plan: ReturnType<typeof decomposeTask> | null
  currentStep: number
}

export function startMultiverseSession(
  sessionId: string,
  task: string,
  config: MultiverseConfig,
) {
  const plan = decomposeTask(task, config.max_depth)

  const tree = initTree(sessionId, task)

  updateTree((t) => ({
    ...t,
    status: "running",
    steps: plan.steps.map((s, i) => ({
      index: s.index,
      description: s.description,
      success_metric: s.success_metric,
      status: i === 0 ? ("running" as const) : ("pending" as const),
      branches:
        i === 0
          ? generateApproaches(s.description, s.success_metric, config.max_branches).map(
              (a, bi) => ({
                id: `${sessionId}-s${s.index}-b${bi}`,
                step_index: s.index,
                branch_index: bi,
                approach: a.label,
                status: "pending" as const,
                tool_calls: [],
              }),
            )
          : [],
      winner_branch_index: undefined,
    })),
    current_step_index: 0,
  }))

  if (config.verbose_logging) {
    console.log(`[Multiverse] Session started: ${sessionId}`)
    console.log(`[Multiverse] Plan: ${plan.steps.length} steps`)
    console.log(`[Multiverse] Task: ${task}`)
  }

  void (async () => {
    try {
      const { traceSessionStart } = await import("./langfuse")
      traceSessionStart(sessionId, task, plan.steps.length)
    } catch {}
  })()

  return { plan, tree: getTreeState() }
}

export function advanceStep(
  sessionId: string,
  stepIndex: number,
  branchIndex: number,
  score: number,
  result: string,
) {
  const branchId = `${sessionId}-s${stepIndex}-b${branchIndex}`
  try {
    logBranchExecution(branchId, stepIndex, "approach", [], score >= 50, score)
  } catch {}

  updateTree((t) => {
    const steps = [...t.steps]
    const step = { ...steps[stepIndex] }
    const branches = [...step.branches]
    const branch = { ...branches[branchIndex] }

    branch.status = "success" as const
    branch.score = score
    branch.result = result
    branches[branchIndex] = branch

    step.branches = branches
    step.winner_branch_index = branchIndex
    step.status = "completed" as const
    steps[stepIndex] = step

    const nextIndex = stepIndex + 1
    if (nextIndex < steps.length) {
      const nextStep = { ...steps[nextIndex] }
      nextStep.status = "running" as const
      nextStep.branches = generateApproaches(
        nextStep.description,
        nextStep.success_metric,
        5,
      ).map((a, bi) => ({
        id: `${sessionId}-s${nextStep.index}-b${bi}`,
        step_index: nextStep.index,
        branch_index: bi,
        approach: a.label,
        status: "pending" as const,
        tool_calls: [],
      }))
      steps[nextIndex] = nextStep
    }

    return {
      ...t,
      steps,
      current_step_index: nextIndex < steps.length ? nextIndex : t.current_step_index,
      status: nextIndex >= steps.length ? ("completed" as const) : t.status,
    }
  })

  void (async () => {
    try {
      const { traceBranchExecution, traceStepComplete } = await import("./langfuse")
      const { persistTreeState } = await import("./clickhouse")
      const tree = getTreeState()
      const branch = tree?.steps[stepIndex]?.branches[branchIndex]
      if (branch) {
        traceBranchExecution(sessionId, stepIndex, branchIndex, branch.approach, true, score, branch.tool_calls ?? [], result)
        traceStepComplete(sessionId, stepIndex, branchIndex, branch.approach, [score])
      }
      if (tree) persistTreeState(sessionId, tree)
    } catch {}
  })()
}

export function markBranchRunning(
  sessionId: string,
  stepIndex: number,
  branchIndex: number,
) {
  updateTree((t) => {
    const steps = [...t.steps]
    const step = { ...steps[stepIndex] }
    const branches = [...step.branches]
    const branch = { ...branches[branchIndex] }
    branch.status = "running" as const
    branches[branchIndex] = branch
    step.branches = branches
    steps[stepIndex] = step
    return { ...t, steps }
  })
}

export function markBranchFailed(
  sessionId: string,
  stepIndex: number,
  branchIndex: number,
  reason: string,
) {
  updateTree((t) => {
    const steps = [...t.steps]
    const step = { ...steps[stepIndex] }
    const branches = [...step.branches]
    const branch = { ...branches[branchIndex] }
    branch.status = "failed" as const
    branch.result = reason
    branches[branchIndex] = branch
    step.branches = branches
    steps[stepIndex] = step
    return { ...t, steps }
  })

  void (async () => {
    try {
      const { traceBranchExecution } = await import("./langfuse")
      const { persistTreeState } = await import("./clickhouse")
      const tree = getTreeState()
      const branch = tree?.steps[stepIndex]?.branches[branchIndex]
      if (branch) {
        traceBranchExecution(sessionId, stepIndex, branchIndex, branch.approach, false, 0, branch.tool_calls ?? [], reason)
      }
      if (tree) persistTreeState(sessionId, tree)
    } catch {}
  })()
}

export function endMultiverseSession(sessionId: string) {
  updateTree((t) => ({ ...t, status: "completed" as const }))

  void (async () => {
    try {
      const { traceSessionComplete } = await import("./langfuse")
      const { persistTreeState } = await import("./clickhouse")
      const tree = getTreeState()
      if (tree) {
        traceSessionComplete(sessionId, tree.steps.length, tree.steps.filter(s => s.status === "completed").length, tree)
        persistTreeState(sessionId, tree)
      }
    } catch {}
  })()
}

export { decomposeTask, generateApproaches, verifyResult, initTree, updateTree, getTreeState, clearTree }

export * as Multiverse from "."
