import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "./builtins"

const id = "internal:multiverse-commands"

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      app(_ctx) {
        return (
          <box paddingTop={1} paddingBottom={1}>
            <text fg="#ffaa00">🔀 MULTIVERSE READY — type /multiverse to start</text>
          </box>
        )
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }
export default plugin
