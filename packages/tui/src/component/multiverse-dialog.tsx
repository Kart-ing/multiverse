import { createSignal, onCleanup, onMount } from "solid-js"

const DEMO_STEPS = [
  "Plan architecture & layout",
  "Create HTML structure",
  "Style with CSS",
  "Add hero section",
  "Add features grid",
  "Add footer & polish",
]

const BRANCHES = ["Direct", "Modular", "Minimal", "Robust", "Creative"]

export function MultiverseDialog(props: { onClose: () => void }) {
  const [step, setStep] = createSignal(0)
  const [branches, setBranches] = createSignal<{ index: number; label: string; status: string; score: number }[]>([])
  const [done, setDone] = createSignal(false)
  let timers: any[] = []

  onMount(() => {
    function runStep(s: number) {
      if (s >= DEMO_STEPS.length) { setDone(true); return }
      setStep(s)
      const current: { index: number; label: string; status: string; score: number }[] = []

      BRANCHES.forEach((label, bi) => {
        const t1 = setTimeout(() => {
          // Mark running
          setBranches(prev => [...prev.filter(b => b.index !== bi), { index: bi, label, status: "running", score: 0 }])

          const t2 = setTimeout(() => {
            const score = 55 + Math.floor(Math.random() * 45)
            const passed = Math.random() > 0.15
            const final = { index: bi, label, status: passed ? "pass" : "fail", score }
            setBranches(prev => [...prev.filter(b => b.index !== bi), final])
            current.push(final)

            // After last branch, pick winner and advance
            if (current.length === BRANCHES.length) {
              const winner = current.filter(b => b.status === "pass").sort((a, b) => b.score - a.score)[0]
              // Mark winner
              setBranches(prev => prev.map(b => b.index === winner?.index ? { ...b, status: "winner" } : b))
              // Advance after delay
              setTimeout(() => runStep(s + 1), 1500)
            }
          }, 600 + Math.random() * 800)
          timers.push(t2)
        }, bi * 300)
        timers.push(t1)
      })
    }
    runStep(0)
  })

  onCleanup(() => timers.forEach(clearTimeout))

  const color = (status: string) => {
    switch (status) {
      case "pass": return "#44bb44"
      case "winner": return "#ffaa00"
      case "running": return "#4488ff"
      case "fail": return "#cc4444"
      default: return "#666666"
    }
  }

  const icon = (status: string) => {
    switch (status) {
      case "pass": return "✓"
      case "winner": return "★"
      case "running": return "▸"
      case "fail": return "✗"
      default: return "·"
    }
  }

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={0}>
      <text fg="#f0a030">┌── Multiverse Decision Tree ─────────────────┐</text>
      <text fg="#ffffff">│ Task: Build a landing page                    │</text>
      <text fg="#888888">│ Step {step() + 1}/{DEMO_STEPS.length} · {done() ? "Complete" : "Exploring..."}{" ".repeat(Math.max(0, 18 - (done() ? 8 : 12)))}│</text>
      <text fg="#666666">│                                              │</text>
      {DEMO_STEPS.map((desc, si) => {
        const isCurrent = si === step()
        const isPast = si < step()
        return (
          <box>
            <text fg={isPast ? "#44bb44" : isCurrent ? "#f0a030" : "#666666"}>
              │ {isPast ? "✓" : isCurrent ? "▸" : "·"} {desc.slice(0, 36).padEnd(36, " ")} │
            </text>
            {isCurrent && (
              <box>
                <text fg="#666666">│                                              │</text>
                {branches().map((b: any) => (
                  <text fg={color(b.status)}>
                    │   {icon(b.status)} {(b.label ?? "").padEnd(10, " ")} {b.score}%{" ".repeat(Math.max(0, 24 - String(b.score).length))}│
                  </text>
                ))}
              </box>
            )}
          </box>
        )
      })}
      <text fg="#666666">│                                              │</text>
      <box flexDirection="row" justifyContent="space-between">
        <text fg="#888888">│ Each step: 5 approaches, winner advances</text>
        <text fg={done() ? "#44bb44" : "#666666"}>{done() ? " Done ✓" : " Running..."}</text>
      </box>
      <text fg="#f0a030">└──────────────────────────────────────────────┘</text>
      {done() && (
        <box paddingTop={1} flexDirection="row" gap={2}>
          <text fg="#44bb44" onMouseDown={props.onClose}>[ Close ]</text>
        </box>
      )}
    </box>
  )
}
