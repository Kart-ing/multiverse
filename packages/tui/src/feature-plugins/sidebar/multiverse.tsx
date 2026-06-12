import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:sidebar-multiverse"

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 500,
    slots: {
      sidebar_content(_ctx, props) {
        return (
          <box>
            <text fg="#ff8800">┌── Multiverse ────────┐</text>
            <text fg="#ffffff">│ Build a landing page │</text>
            <text fg="#44bb44">│ ✓ Plan architecture  │</text>
            <text fg="#f0a030">│ ▸ Create structure   │</text>
            <text fg="#666666">│ · Style with CSS     │</text>
            <text fg="#ff8800">└──────────────────────┘</text>
          </box>
        )
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }
export default plugin
