import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal, onCleanup, onMount } from "solid-js"
import { subscribeTree, getTreeState } from "../../util/multiverse-engine"

const id = "internal:sidebar-multiverse"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [tree, setTree] = createSignal<any>(null)
  let unsub: (() => void) | undefined

  onMount(() => {
    const t = getTreeState()
    setTree(t)
    unsub = subscribeTree((t: any) => setTree(t))
  })
  onCleanup(() => unsub?.())

  const t = tree()
  if (!t || t.status === "idle") return null

  const done = t.steps?.filter((s: any) => s.status === "completed").length ?? 0
  const total = t.steps?.length ?? 0

  return (
    <box gap={0}>
      <text fg="#f0a030">┌── Multiverse ────────┐</text>
      <text fg="#ffffff">│ {(t.root_task ?? "").slice(0, 20)}│</text>
      <text fg="#888888">│ {done}/{total} steps · {t.status}│</text>
      <text fg="#666666">│                      │</text>
      {(t.steps ?? []).map((s: any) => (
        <box>
          <text fg={s.status === "completed" ? "#44bb44" : s.status === "running" ? "#f0a030" : "#666666"}>
            │ {s.status === "completed" ? "✓" : s.status === "running" ? "▸" : "·"} {(s.description ?? "").slice(0, 18)}
          </text>
          {(s.branches ?? []).filter((b: any) => b.status !== "pending").slice(0, 3).map((b: any) => (
            <text fg={b.status === "success" ? "#88cc88" : b.status === "failed" ? "#cc4444" : b.status === "running" ? "#ddaa44" : "#555555"}>
              │   {b.status === "success" ? "✓" : b.status === "failed" ? "✗" : "▸"} {(b.approach ?? "").slice(0, 8)} {b.score ?? "--"}%{s.winner_branch_index === b.branch_index ? " ★" : ""}
            </text>
          ))}
        </box>
      ))}
      <text fg="#f0a030">└──────────────────────┘</text>
    </box>
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
