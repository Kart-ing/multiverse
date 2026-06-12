// Inline multiverse tree state for TUI (avoids cross-package import issue)

export class BranchState {
  id = ""
  step_index = 0
  branch_index = 0
  approach = ""
  status: "pending" | "running" | "success" | "failed" = "pending"
  result?: string
  tool_calls: string[] = []
  score?: number
  constructor(init?: Partial<BranchState>) { Object.assign(this, init) }
}

export class StepState {
  index = 0
  description = ""
  success_metric = ""
  status: "pending" | "running" | "completed" | "failed" = "pending"
  branches: BranchState[] = []
  winner_branch_index?: number
  constructor(init?: Partial<StepState>) { Object.assign(this, init) }
}

export class MultiverseTree {
  session_id = ""
  root_task = ""
  status: "idle" | "planning" | "running" | "completed" | "failed" = "idle"
  steps: StepState[] = []
  current_step_index = 0
  created_at = Date.now()
  constructor(init?: Partial<MultiverseTree>) { Object.assign(this, init) }
}

let globalTree: MultiverseTree | null = null
const listeners = new Set<(tree: MultiverseTree) => void>()

export function getTreeState(): MultiverseTree | null {
  return globalTree ? { ...globalTree } as MultiverseTree : null
}

export function initTree(sessionId: string, task: string): MultiverseTree {
  globalTree = new MultiverseTree({
    session_id: sessionId,
    root_task: task,
    status: "running",
    steps: [],
    current_step_index: 0,
    created_at: Date.now(),
  })
  notify()
  return globalTree
}

export function updateTree(fn: (tree: MultiverseTree) => MultiverseTree): MultiverseTree {
  if (!globalTree) throw new Error("Tree not initialized")
  globalTree = fn(globalTree)
  notify()
  return globalTree
}

export function subscribeTree(listener: (tree: MultiverseTree) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notify() {
  if (!globalTree) return
  const snap = { ...globalTree } as MultiverseTree
  for (const l of listeners) l(snap)
}

export function clearTree() {
  // broadcast an idle tree so subscribers hide themselves, then drop it
  globalTree = new MultiverseTree({ status: "idle" })
  notify()
  globalTree = null
}

// Task decomposition
export function decomposeTask(task: string, maxSteps = 10) {
  const lower = task.toLowerCase()
  const result: { index: number; description: string; success_metric: string }[] = []

  if (lower.includes("build") || lower.includes("create") || lower.includes("implement") || lower.includes("make")) {
    result.push({ index: 0, description: "Analyze requirements", success_metric: "Clear plan exists" })
    result.push({ index: 1, description: "Set up project structure", success_metric: "Project compiles" })
    result.push({ index: 2, description: "Implement core logic", success_metric: "Core types defined" })
    result.push({ index: 3, description: "Build main features", success_metric: "Features work" })
    result.push({ index: 4, description: "Add error handling", success_metric: "No crashes" })
    result.push({ index: 5, description: "Test and verify", success_metric: "Tests pass" })
  } else if (lower.includes("fix") || lower.includes("debug") || lower.includes("bug")) {
    result.push({ index: 0, description: "Reproduce the issue", success_metric: "Bug reproduced" })
    result.push({ index: 1, description: "Find root cause", success_metric: "Root cause found" })
    result.push({ index: 2, description: "Implement fix", success_metric: "Fix compiles" })
    result.push({ index: 3, description: "Verify fix", success_metric: "Bug resolved" })
  } else {
    result.push({ index: 0, description: "Analyze task", success_metric: "Understood" })
    result.push({ index: 1, description: "Plan approach", success_metric: "Plan is clear" })
    result.push({ index: 2, description: "Execute plan", success_metric: "Done" })
    result.push({ index: 3, description: "Verify results", success_metric: "Verified" })
  }
  return result.slice(0, maxSteps)
}

export function generateApproaches(step: string, count = 5) {
  return [
    { index: 0, label: "Direct", strategy: "Straightforward", prompt: `Complete: ${step}` },
    { index: 1, label: "Modular", strategy: "Reusable modules", prompt: `Build modular: ${step}` },
    { index: 2, label: "Minimal", strategy: "Fewest changes", prompt: `Minimal: ${step}` },
    { index: 3, label: "Robust", strategy: "All edge cases", prompt: `Robust: ${step}` },
    { index: 4, label: "Creative", strategy: "Novel approach", prompt: `Creative: ${step}` },
  ].slice(0, count)
}

export function startMultiverseSession(sessionId: string, task: string) {
  const plan = decomposeTask(task)
  initTree(sessionId, task)

  updateTree((t: MultiverseTree) => {
    t.steps = plan.map((s, i) => {
      const step = new StepState({
        index: s.index,
        description: s.description,
        success_metric: s.success_metric,
        status: i === 0 ? "running" : "pending",
      })
      if (i === 0) {
        step.branches = generateApproaches(s.description).map((a, bi) =>
          new BranchState({
            id: `${sessionId}-s${s.index}-b${bi}`,
            step_index: s.index,
            branch_index: bi,
            approach: a.label,
            status: "pending",
            tool_calls: [],
          })
        )
      }
      return step
    })
    t.current_step_index = 0
    t.status = "running"
    return t
  })
}

export function advanceStep(sessionId: string, stepIndex: number, branchIndex: number, score: number, result: string) {
  updateTree((t: MultiverseTree) => {
    const step = t.steps[stepIndex]
    if (!step) return t
    const branch = step.branches[branchIndex]
    if (branch) {
      branch.status = "success"
      branch.score = score
      branch.result = result
    }
    step.winner_branch_index = branchIndex
    step.status = "completed"

    const next = stepIndex + 1
    if (next < t.steps.length) {
      const ns = t.steps[next]
      ns.status = "running"
      ns.branches = generateApproaches(ns.description).map((a, bi) =>
        new BranchState({
          id: `${sessionId}-s${ns.index}-b${bi}`,
          step_index: ns.index,
          branch_index: bi,
          approach: a.label,
          status: "pending",
          tool_calls: [],
        })
      )
      t.current_step_index = next
    } else {
      t.status = "completed"
    }
    return t
  })
}

export function markBranchDone(sessionId: string, stepIndex: number, branchIndex: number, score: number) {
  updateTree((t: MultiverseTree) => {
    const step = t.steps[stepIndex]
    if (!step) return t
    const branch = step.branches[branchIndex]
    if (branch) {
      branch.status = "success"
      branch.score = score
    }
    return t
  })
}

export function markBranchRunning(sessionId: string, stepIndex: number, branchIndex: number) {
  updateTree((t: MultiverseTree) => {
    const step = t.steps[stepIndex]
    if (!step) return t
    const branch = step.branches[branchIndex]
    if (branch) branch.status = "running"
    return t
  })
}

export function markBranchFailed(sessionId: string, stepIndex: number, branchIndex: number, reason: string) {
  updateTree((t: MultiverseTree) => {
    const step = t.steps[stepIndex]
    if (!step) return t
    const branch = step.branches[branchIndex]
    if (branch) {
      branch.status = "failed"
      branch.result = reason
    }
    return t
  })
}
