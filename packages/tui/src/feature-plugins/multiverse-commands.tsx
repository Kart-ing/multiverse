import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "./builtins"

const id = "internal:multiverse-commands"

const tui: TuiPlugin = async (api) => {
  api.commands.register({
    name: "multiverse.start",
    title: "Start Multiverse decision tree",
    category: "Multiverse",
    slashName: "multiverse",
    slashAliases: ["mv", "parallel", "tree"],
    run: async () => {
      try {
        const { activateMultiverse } = await import("@opencode-ai/opencode/multiverse/activate")
        await api.toast.show({
          variant: "info",
          message:
            "Multiverse mode activated! All permissions will be auto-allowed. Use /mv-build to decompose a task.",
          duration: 5000,
        })
        activateMultiverse("pending", "")
      } catch (e) {
        await api.toast.show({
          variant: "error",
          message: "Failed to activate Multiverse mode",
        })
      }
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
