<p align="center">
  <h1 align="center">🔀 Multiverse</h1>
  <p align="center"><strong>Decision Tree Agent Mode — explore 5 paths, pick the winner.</strong></p>
</p>

<p align="center">
  <a href="https://github.com/Kart-ing/multiverse"><img alt="GitHub" src="https://img.shields.io/badge/fork_of-OpenCode-blue?style=flat-square" /></a>
</p>

---

> **Fork of [OpenCode](https://github.com/anomalyco/opencode)** — the open source AI coding agent.  
> Multiverse adds a **decision tree agent mode** that explores multiple approaches in parallel.

## 🔀 What is Multiverse?

Multiverse extends OpenCode with a **decision tree execution mode**. When activated, it:

1. **Decomposes** your task into sequential steps with success metrics
2. **Explores 5 parallel approaches** per step (Direct, Modular, Minimal, Robust, Creative)
3. **Verifies** each approach against the success metric (scores 0–100)
4. **Prunes** — only the winning branch advances to the next step
5. **Auto-allows** all permissions so nothing blocks execution

Type `/multiverse` to see the decision tree in action.

## 🚀 Quick Start

```bash
git clone https://github.com/Kart-ing/multiverse.git
cd multiverse
bun install
./bin/install.sh     # symlinks `multiverse` to ~/.local/bin
multiverse            # launch the TUI
```

Then type `/multiverse` to activate decision tree mode.

## 🏆 Sponsor Integrations

Built for the **Harness Engineering Hackathon** (June 2026). All integrations gracefully fall back if no keys are set.

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
