import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal, onCleanup, Show, onMount } from "solid-js"
import { subscribeTree, getTreeState } from "../../util/multiverse-engine"

const id = "internal:sidebar-multiverse"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [tree, setTree] = createSignal<any>(null)
  const [ready, setReady] = createSignal(false)
  let unsubscribe: (() => void) | undefined

  onMount(() => {
    const t = getTreeState()
    if (t) setTree(t)
    unsubscribe = subscribeTree((t: any) => setTree(t))
    setReady(true)
  })

  onCleanup(() => unsubscribe?.())

  const visible = () => ready() && tree() && tree().status === "running"

  return (
    <Show when={visible()}>
      <box>
        <text fg={theme().warning}>
          ┌─ MULTIVERSE ────────────┐
        </text>
        <text fg={theme().text}>
          │ Task: {(tree()?.root_task ?? "").slice(0, 23).padEnd(23, " ")}│
        </text>
        <text fg={theme().textMuted}>
          │ Steps: {(tree()?.steps?.filter((s: any) => s.status === "completed").length ?? 0)}/{(tree()?.steps?.length ?? 0)} completed        │
        </text>
        <text fg={theme().textMuted}>│                            │</text>
        {(tree()?.steps ?? []).map((step: any) => (
          <box>
            <text fg={step.status === "completed" ? theme().success : step.status === "running" ? theme().warning : theme().textMuted}>
              │ {step.status === "completed" ? "✓" : step.status === "running" ? "▸" : "·"} {(step.description ?? "").slice(0, 20).padEnd(20, " ")}       │
            </text>
            {(step.branches ?? []).slice(0, 3).map((b: any) => (
              <text fg={b.status === "success" ? theme().success : b.status === "failed" ? theme().danger : b.status === "running" ? theme().warning : theme().textMuted}>
                │   {b.status === "success" ? "✓" : b.status === "failed" ? "✗" : b.status === "running" ? "▸" : "·"} {(b.approach ?? "").slice(0, 8).padEnd(8, " ")} {b.score != null ? b.score + "%" : ""} {step.winner_branch_index === b.branch_index ? "★" : ""}
              </text>
            ))}
          </box>
        ))}
        <text fg={theme().warning}>
          └────────────────────────────┘
        </text>
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
