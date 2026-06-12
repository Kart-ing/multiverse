import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "./builtins"
import { createSignal, createMemo, onCleanup, Show, onMount } from "solid-js"

const id = "internal:multiverse-commands"

function MultiverseStatus(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [active, setActive] = createSignal(false)
  let interval: any

  onMount(() => {
    interval = setInterval(() => {
      setActive(!!(globalThis as any).__MULTIVERSE_ENABLED__)
    }, 1000)
  })

  onCleanup(() => clearInterval(interval))

  return (
    <Show when={active()}>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} backgroundColor={theme().backgroundElement}>
        <text fg={theme().warning}>
          🔀 Multiverse active — exploring 5 parallel paths per step
        </text>
        <text fg={theme().textMuted}>
          Type /multiverse to toggle  |  /mv to toggle
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
