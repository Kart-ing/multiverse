import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "./builtins"
import { createSignal, onCleanup, Show, onMount } from "solid-js"
import {
  startMultiverseSession, advanceStep, markBranchRunning, markBranchFailed,
  subscribeTree, getTreeState,
} from "../util/multiverse-engine"

const id = "internal:multiverse-commands"

const DEMO_TASK = "Build a landing page with hero, features, and footer"

function runDemo() {
  startMultiverseSession("demo", DEMO_TASK)

  let step = 0
  const steps = [
    { desc: "Plan architecture & layout", metric: "Clear wireframe" },
    { desc: "Create HTML structure", metric: "Valid HTML5" },
    { desc: "Style with CSS", metric: "Responsive layout" },
    { desc: "Add hero section", metric: "CTA visible" },
    { desc: "Add features grid", metric: "3+ cards" },
    { desc: "Add footer & polish", metric: "Complete page" },
  ]

  const interval = setInterval(() => {
    if (step >= steps.length) { clearInterval(interval); return }
    const branches = ["Direct", "Modular", "Minimal", "Robust", "Creative"]

    branches.forEach((_b, bi) => {
      setTimeout(() => {
        markBranchRunning("demo", step, bi)
        setTimeout(() => {
          const success = Math.random() > 0.1
          const score = success ? 60 + Math.floor(Math.random() * 40) : 10 + Math.floor(Math.random() * 40)
          if (success) { advanceStep("demo", step, bi, score, `Score: ${score}%`) }
          else { markBranchFailed("demo", step, bi, "Verification failed") }
        }, 500 + Math.random() * 700)
      }, bi * 250)
    })
    step++
  }, 3000)

  return () => clearInterval(interval)
}

// Tree view rendered in the global "app" slot (visible everywhere)
function TreeOverlay() {
  const [tree, setTree] = createSignal<any>(null)
  const [active, setActive] = createSignal(false)
  let cleanup: (() => void) | undefined
  let unsub: (() => void) | undefined

  onMount(() => {
    unsub = subscribeTree((t: any) => setTree(t))
    const interval = setInterval(() => {
      const was = active()
      const is = !!(globalThis as any).__MULTIVERSE_ENABLED__
      setActive(is)
      if (is && !was) { cleanup?.(); cleanup = runDemo() }
      if (!is && was) { cleanup?.(); setTree(null) }
    }, 300)
    onCleanup(() => { clearInterval(interval); unsub?.(); cleanup?.() })
  })

  const visible = () => active() && tree() && tree().status === "running"

  return (
    <Show when={visible()}>
      <box flexDirection="row" gap={1} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <box flexDirection="column" gap={0}>
          <text fg="#f0a030">┌── Multiverse ────────────┐</text>
          <text fg="#ffffff">│ {(tree()?.root_task ?? "").slice(0, 23)}│</text>
          <text fg="#888888">│ {(tree()?.steps?.filter((s: any) => s.status === "completed").length ?? 0)}/{(tree()?.steps?.length ?? 0)} steps · {tree()?.status}│</text>
          {(tree()?.steps ?? []).slice(0, 6).map((s: any) => (
            <box>
              <text fg={s.status === "completed" ? "#44bb44" : s.status === "running" ? "#f0a030" : "#666666"}>
                │ {s.status === "completed" ? "✓" : s.status === "running" ? "▸" : "·"} {(s.description ?? "").slice(0, 20)}
              </text>
              {(s.branches ?? []).slice(0, 3).map((b: any) => (
                <text fg={b.status === "success" ? "#88cc88" : b.status === "failed" ? "#cc4444" : b.status === "running" ? "#ddaa44" : "#555555"}>
                  │   {b.status === "success" ? "✓" : b.status === "failed" ? "✗" : b.status === "running" ? "▸" : "·"} {(b.approach ?? "").slice(0, 8)} {b.score ?? "--"}%{s.winner_branch_index === b.branch_index ? " ★" : ""}
                </text>
              ))}
            </box>
          ))}
          <text fg="#f0a030">└────────────────────────────┘</text>
        </box>
      </box>
    </Show>
  )
}

// Status bar shown in the app slot when active but no tree yet
function StatusBar() {
  const [active, setActive] = createSignal(false)
  
  onMount(() => {
    const interval = setInterval(() => setActive(!!(globalThis as any).__MULTIVERSE_ENABLED__), 500)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <Show when={active()}>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2}>
        <text fg="#f0a030">🔀 Multiverse active — start a chat to see the decision tree</text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      app(_ctx) {
        return <TreeOverlay />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }
export default plugin
