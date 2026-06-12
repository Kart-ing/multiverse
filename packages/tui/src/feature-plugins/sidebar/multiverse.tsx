import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal, createMemo, onCleanup, Show, onMount } from "solid-js"

const id = "internal:sidebar-multiverse"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [tree, setTree] = createSignal<any>(null)
  const [ready, setReady] = createSignal(false)
  let unsubscribe: (() => void) | undefined

  onMount(() => {
    import("@opencode-ai/opencode/multiverse/tree-state")
      .then((mod) => {
        const current = mod.getTreeState()
        if (current) setTree({ ...current })
        unsubscribe = mod.subscribeTree((t: any) => setTree({ ...t }))
        setReady(true)
      })
      .catch(() => {})
  })

  onCleanup(() => unsubscribe?.())

  const show = createMemo(() => ready() && tree() && tree().status !== "idle")

  const statusIcon = (status: string, isWinner?: boolean) => {
    if (isWinner) return "★"
    switch (status) {
      case "completed": return "✓"
      case "success": return "✓"
      case "running": return "▸"
      case "failed": return "✗"
      case "pending": return "·"
      default: return " "
    }
  }

  const statusFg = (status: string) => {
    switch (status) {
      case "completed": return theme().success
      case "success": return theme().success
      case "running": return theme().warning
      case "failed": return theme().danger
      default: return theme().textMuted
    }
  }

  const truncate = (s: string, max: number) => {
    if (!s) return ""
    return s.length > max ? s.slice(0, max - 1) + "…" : s.padEnd(max, " ")
  }

  return (
    <Show when={show()}>
      <box gap={0} paddingBottom={1}>
        <text fg={theme().warning}>
          ┌─ Multiverse ─{"─".repeat(15)}┐
        </text>
        <text fg={theme().text}>
          │ {truncate(tree().root_task, 28)}│
        </text>
        <text fg={theme().textMuted}>
          │ {tree().steps.filter((s: any) => s.status === "completed").length}/{tree().steps.length} steps · {tree().status}{" ".repeat(Math.max(0, 12 - tree().status.length))}│
        </text>
        <text fg={theme().textMuted}>│{" ".repeat(28)}│</text>
        {(() => {
          const rows: any[] = []
          for (const step of tree().steps) {
            const icon = statusIcon(step.status)
            const cfg = statusFg(step.status)
            rows.push(
              <text fg={cfg}>
                │ {icon} {truncate(step.description, 24)}{step.status === "completed" ? " ✓" : step.status === "running" ? " ▸" : ""} │
              </text>
            )
            if (step.branches && step.branches.length > 0 && (step.status === "running" || step.status === "completed")) {
              const shown = step.branches.slice(0, 3)
              for (const branch of shown) {
                const isWinner = step.winner_branch_index === branch.branch_index
                const bIcon = statusIcon(branch.status, isWinner)
                const bFg = statusFg(branch.status)
                const pct = branch.score != null ? ` ${branch.score}%` : ""
                rows.push(
                  <text fg={bFg}>
                    │   {bIcon} {truncate(branch.approach, 10)}{pct}{isWinner ? " ★" : ""}{" ".repeat(Math.max(0, 8 - pct.length - (isWinner ? 2 : 0)))}│
                  </text>
                )
              }
              if (step.branches.length > 3) {
                rows.push(
                  <text fg={theme().textMuted}>
                    │   ··· +{step.branches.length - 3} more{" ".repeat(10)}│
                  </text>
                )
              }
            }
          }
          return rows
        })()}
        <text fg={theme().warning}>└{"─".repeat(28)}┘</text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 500,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }
export default plugin
