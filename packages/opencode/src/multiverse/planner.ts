export interface PlanStep {
  index: number
  description: string
  success_metric: string
}

export interface Plan {
  steps: PlanStep[]
  reasoning: string
}

export function decomposeTask(task: string, maxSteps: number = 10): Plan {
  const steps = breakIntoSteps(task, maxSteps)
  return {
    steps,
    reasoning: `Decomposed "${task}" into ${steps.length} steps.`,
  }
}

function breakIntoSteps(task: string, max: number): PlanStep[] {
  const lower = task.toLowerCase()
  const result: PlanStep[] = []

  if (
    lower.includes("build") ||
    lower.includes("create") ||
    lower.includes("implement") ||
    lower.includes("make")
  ) {
    result.push({
      index: 0,
      description: "Analyze requirements and plan architecture",
      success_metric: "Clear architecture plan exists",
    })
    result.push({
      index: 1,
      description: "Set up project structure and dependencies",
      success_metric: "Project compiles/starts without errors",
    })
    result.push({
      index: 2,
      description: "Implement core logic/data models",
      success_metric: "Core types/models defined and validated",
    })
    result.push({
      index: 3,
      description: "Implement main features",
      success_metric: "Feature tests pass or manual verification succeeds",
    })
    result.push({
      index: 4,
      description: "Add error handling and edge cases",
      success_metric: "Edge cases handled, no crashes on invalid input",
    })
    result.push({
      index: 5,
      description: "Test and verify end-to-end",
      success_metric: "All tests pass or demo works correctly",
    })
  } else if (lower.includes("fix") || lower.includes("debug") || lower.includes("bug")) {
    result.push({
      index: 0,
      description: "Reproduce and understand the issue",
      success_metric: "Bug is reproducible and root cause identified",
    })
    result.push({
      index: 1,
      description: "Explore potential solutions",
      success_metric: "At least one viable fix identified",
    })
    result.push({
      index: 2,
      description: "Implement the fix",
      success_metric: "Fix compiles and addresses root cause",
    })
    result.push({
      index: 3,
      description: "Verify fix and check for regressions",
      success_metric: "Bug no longer reproduces, no new issues",
    })
  } else if (lower.includes("refactor") || lower.includes("clean")) {
    result.push({
      index: 0,
      description: "Analyze current code structure",
      success_metric: "Current architecture and pain points documented",
    })
    result.push({
      index: 1,
      description: "Design improved structure",
      success_metric: "New architecture plan is clear and improves on current",
    })
    result.push({
      index: 2,
      description: "Implement refactoring incrementally",
      success_metric: "Each refactored module works correctly",
    })
    result.push({
      index: 3,
      description: "Verify behavior is preserved",
      success_metric: "All existing tests pass, no functional changes",
    })
  } else if (lower.includes("test") || lower.includes("spec")) {
    result.push({
      index: 0,
      description: "Understand what needs testing",
      success_metric: "Test plan covers all critical paths",
    })
    result.push({
      index: 1,
      description: "Write test cases",
      success_metric: "Tests cover happy path and edge cases",
    })
    result.push({
      index: 2,
      description: "Run tests and fix failures",
      success_metric: "All tests pass",
    })
  } else {
    result.push({
      index: 0,
      description: "Analyze and understand the task",
      success_metric: "Clear understanding of what needs to be done",
    })
    result.push({
      index: 1,
      description: "Research and plan approach",
      success_metric: "Approach plan is clear and feasible",
    })
    result.push({
      index: 2,
      description: "Execute the planned approach",
      success_metric: "Task is completed successfully",
    })
    result.push({
      index: 3,
      description: "Verify and validate results",
      success_metric: "Results match requirements",
    })
  }

  return result.slice(0, max)
}

export * as Planner from "./planner"
