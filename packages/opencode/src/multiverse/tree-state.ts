import { Schema } from "effect"

export class BranchState extends Schema.Class<BranchState>("BranchState")({
  id: Schema.String,
  step_index: Schema.Number,
  branch_index: Schema.Number,
  approach: Schema.String,
  status: Schema.Literal("pending", "running", "success", "failed"),
  result: Schema.optional(Schema.String),
  tool_calls: Schema.Array(Schema.String),
  score: Schema.optional(Schema.Number),
}) {}

export class StepState extends Schema.Class<StepState>("StepState")({
  index: Schema.Number,
  description: Schema.String,
  success_metric: Schema.String,
  status: Schema.Literal("pending", "running", "completed", "failed"),
  branches: Schema.Array(BranchState),
  winner_branch_index: Schema.optional(Schema.Number),
}) {}

export class MultiverseTree extends Schema.Class<MultiverseTree>("MultiverseTree")({
  session_id: Schema.String,
  root_task: Schema.String,
  status: Schema.Literal("idle", "planning", "running", "completed", "failed"),
  steps: Schema.Array(StepState),
  current_step_index: Schema.Number,
  created_at: Schema.Number,
}) {}

export interface TreeStateRef {
  readonly get: () => MultiverseTree
  readonly update: (fn: (tree: MultiverseTree) => MultiverseTree) => void
  readonly subscribe: (listener: (tree: MultiverseTree) => void) => () => void
}

let globalTree: MultiverseTree | null = null
const listeners = new Set<(tree: MultiverseTree) => void>()

export function getTreeState(): MultiverseTree | null {
  return globalTree
}

export function initTree(sessionId: string, task: string): MultiverseTree {
  const tree = new MultiverseTree({
    session_id: sessionId,
    root_task: task,
    status: "planning",
    steps: [],
    current_step_index: 0,
    created_at: Date.now(),
  })
  globalTree = tree
  notify(tree)
  return tree
}

export function updateTree(fn: (tree: MultiverseTree) => MultiverseTree): MultiverseTree {
  if (!globalTree) throw new Error("Tree not initialized")
  globalTree = fn(globalTree)
  notify(globalTree)
  return globalTree
}

export function subscribeTree(listener: (tree: MultiverseTree) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(tree: MultiverseTree) {
  for (const listener of listeners) listener(tree)
}

export function clearTree() {
  globalTree = null
}

export * as TreeState from "./tree-state"
