import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal, onCleanup, Show, onMount } from "solid-js"
import { subscribeTree, getTreeState, startMultiverseSession, advanceStep, markBranchRunning, markBranchFailed } from "../../util/multiverse-engine"

const id = "internal:sidebar-multiverse"

const DEMO_TASK = "Build a landing page with hero, features, and footer"

function runDemo() {
  startMultiverseSession("demo", DEMO_TASK)

  let step = 0
  const steps = [
    "Plan architecture & layout",
    "Create HTML structure",
    "Style with CSS",
    "Add hero section",
    "Add features grid",
    "Add footer & polish",
  ]

  const interval = setInterval(() => {
    if (step >= steps.length) { clearInterval(interval); return }
    const labels = ["Direct", "Modular", "Minimal", "Robust", "Creative"]

    labels.forEach((_b, bi) => {
      setTimeout(() => {
        markBranchRunning("demo", step, bi)
        setTimeout(() => {
          const score = 60 + Math.floor(Math.random() * 40)
          advanceStep("demo", step, bi, score, `Score: ${score}%`)
        }, 400 + Math.random() * 600)
      }, bi * 200)
    })
    step++
  }, 3000)

  return () => clearInterval(interval)
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [tree, setTree] = createSignal<any>(null)
  let cleanup: (() => void) | undefined
  let unsub: (() => void) | undefined

  onMount(() => {
    const t = getTreeState()
    if (t) setTree(t)
    unsub = subscribeTree((t: any) => setTree(t))

    const interval = setInterval(() => {
      const is = !!(globalThis as any).__MULTIVERSE_ENABLED__
      if (is && !cleanup) cleanup = runDemo()
      if (!is && cleanup) { cleanup(); cleanup = undefined; setTree(null) }
    }, 300)

    onCleanup(() => { clearInterval(interval); unsub?.(); cleanup?.() })
  })

  const t = tree()

  return (
    <Show when={!!t}>
      <box gap={0}>
        <text fg="#f0a030">┌── Multiverse ────────┐</text>
        <text fg="#ffffff">│ {(t?.root_task ?? "").slice(0, 20)}│</text>
        <text fg="#888888">│ {(t?.steps?.filter((s: any) => s.status === "completed").length ?? 0)}/{(t?.steps?.length ?? 0)} steps · {t?.status}│</text>
        <text fg="#666666">│                      │</text>
        {(t?.steps ?? []).map((s: any) => (
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
