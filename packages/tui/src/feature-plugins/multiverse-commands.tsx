import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "./builtins"
import { createSignal, onCleanup, Show, onMount } from "solid-js"
import {
  startMultiverseSession, advanceStep, markBranchRunning, markBranchFailed,
} from "../util/multiverse-engine"

const id = "internal:multiverse-commands"

const DEMO_TASK = "Build a landing page with hero, features section, and footer"
const DEMO_STEPS = [
  { desc: "Plan architecture & layout", metric: "Clear wireframe" },
  { desc: "Create HTML structure", metric: "Valid HTML5" },
  { desc: "Style with CSS", metric: "Responsive design" },
  { desc: "Add hero section", metric: "CTA visible above fold" },
  { desc: "Add features grid", metric: "3+ feature cards" },
  { desc: "Add footer & polish", metric: "Complete page" },
]

function runDemo() {
  startMultiverseSession("demo", DEMO_TASK)

  let step = 0
  const interval = setInterval(() => {
    if (step >= DEMO_STEPS.length) {
      clearInterval(interval)
      return
    }
    const branches = ["Direct", "Modular", "Minimal", "Robust", "Creative"]

    branches.forEach((_b, bi) => {
      setTimeout(() => {
        markBranchRunning("demo", step, bi)
        setTimeout(() => {
          const success = Math.random() > 0.15
          const score = success ? 60 + Math.floor(Math.random() * 40) : 10 + Math.floor(Math.random() * 40)
          if (success) {
            advanceStep("demo", step, bi, score, `Score: ${score}%`)
          } else {
            markBranchFailed("demo", step, bi, "Failed verification")
          }
        }, 600 + Math.random() * 800)
      }, bi * 300)
    })

    step++
  }, 3500)

  return () => clearInterval(interval)
}

function MultiverseStatus(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [active, setActive] = createSignal(false)
  let interval: any
  let cleanup: (() => void) | undefined

  onMount(() => {
    interval = setInterval(() => {
      const wasActive = active()
      const isActive = !!(globalThis as any).__MULTIVERSE_ENABLED__
      setActive(isActive)
      if (isActive && !wasActive) {
        cleanup?.()
        cleanup = runDemo()
      }
      if (!isActive && wasActive) {
        cleanup?.()
        cleanup = undefined
      }
    }, 500)
  })

  onCleanup(() => {
    clearInterval(interval)
    cleanup?.()
  })

  return (
    <Show when={active()}>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} backgroundColor={theme().backgroundElement}>
        <text fg={theme().warning}>
          🔀 Multiverse active — exploring 5 parallel paths per step
        </text>
        <text fg={theme().textMuted}>
          Type /multiverse to toggle
        </text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      app(_ctx) {
        return <MultiverseStatus api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }
export default plugin
