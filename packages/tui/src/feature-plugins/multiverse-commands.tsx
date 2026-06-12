import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "./builtins"

const id = "internal:multiverse-commands"

const tui: TuiPlugin = async (api) => {
  // Banner slot - shows at bottom of app (currently not rendering, sidebar works instead)
}

const plugin: BuiltinTuiPlugin = { id, tui }
export default plugin
