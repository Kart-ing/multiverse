<p align="center">
  <h1 align="center">🔀 Multiverse</h1>
  <p align="center"><strong>An OpenCode fork with a decision-tree agent mode, designed to try five approaches per step and keep the winner. A hackathon prototype.</strong></p>
</p>

<p align="center">
  <a href="https://github.com/Kart-ing/multiverse"><img alt="GitHub" src="https://img.shields.io/badge/fork_of-OpenCode-blue?style=flat-square" /></a>
</p>

---

> **Fork of [OpenCode](https://github.com/anomalyco/opencode)**, the open source AI coding agent.  
> Multiverse adds a **decision-tree agent mode** on top of it.

**Team.** Lance Streuber, Ujjwal Aggarwal and Kartikey Pandey built Multiverse at the Harness Engineering Hack in June 2026. [Devpost](https://devpost.com/software/multiverse-xgqfrp)

> [!WARNING]
> Multiverse mode auto-allows every permission request, so the agent never stops to ask before it acts (`auto_allow_permissions` defaults to `true`). Only run `/multiverse` in a throwaway checkout.

## 🔀 What is Multiverse?

Multiverse is a hackathon prototype: an OpenCode fork with a decision-tree agent mode designed to try five approaches per step and keep the winner. The design:

1. **Decompose** the task into sequential steps, each with a success metric.
2. **Try 5 approaches** per step: Direct, Modular, Minimal, Robust and Creative.
3. **Score** each approach from 0 to 100 against the step's metric.
4. **Prune**, so only the winning branch advances to the next step.
5. **Auto-allow** every permission, so nothing blocks execution. See the warning above.

Sandboxed APIs and deterministic replay are not built yet. In the TUI today, `/multiverse` and `/mv-build` animate the tree over six fixed demo steps with simulated scores; the engine isn't wired into them yet.

## 🚀 Quick Start

```bash
git clone https://github.com/Kart-ing/multiverse.git
cd multiverse
bun install
./bin/install.sh     # symlinks `multiverse` to ~/.local/bin
multiverse            # launch the TUI
```

Then type `/multiverse` to open the decision-tree demo, or `/mv-build` to open it with the task you've typed as its title.

## 🏆 Sponsor Integrations

Built for the **Harness Engineering Hack** (June 2026). All integrations gracefully fall back if no keys are set.

| Sponsor | What | Setup |
|---------|------|-------|
| **Pioneer** | Inference via `claude-sonnet-4-6` | `PIONEER_API_KEY` in `.env` |
| **Langfuse** | Branch-level LLM tracing | `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` |
| **ClickHouse** | Tree state persistence | `CLICKHOUSE_HOST` + credentials |
| **Composio** | Managed tool execution | `COMPOSIO_API_KEY` |

Copy `.env.template` to `.env` and fill in your keys.

## 📁 Project Structure

```
packages/
├── opencode/src/multiverse/   # Decision tree engine
├── tui/src/
│   ├── component/multiverse-dialog.tsx  # Animated tree popup
│   ├── feature-plugins/sidebar/multiverse.tsx  # Sidebar tree (WIP)
│   └── util/multiverse-engine.ts  # Core tree state + demo runner
└── app/src/context/           # Auto-allow permissions
```

## ⚖️ License & Attribution

This is a fork of [OpenCode](https://github.com/anomalyco/opencode) by AnomalyCo.  
Multiverse is not affiliated with or endorsed by the OpenCode team.  
See [LICENSE](./LICENSE) for full terms.
