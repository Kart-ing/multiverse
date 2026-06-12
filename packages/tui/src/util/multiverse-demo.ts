// Demo driver for the multiverse decision tree.
// Called directly from the /multiverse command — no slot or polling dependency.
import {
  startMultiverseSession,
  advanceStep,
  markBranchRunning,
  markBranchDone,
  markBranchFailed,
  clearTree,
  getTreeState,
} from "./multiverse-engine"

const DEMO_TASK = "Build a landing page with hero, features, and footer"
const BRANCH_COUNT = 5

let timers: ReturnType<typeof setTimeout>[] = []

function clearTimers() {
  for (const t of timers) clearTimeout(t)
  timers = []
}

export function stopMultiverseDemo() {
  clearTimers()
  clearTree()
}

export function runMultiverseDemo() {
  clearTimers()
  startMultiverseSession("demo", DEMO_TASK)
  const stepCount = getTreeState()?.steps.length ?? 0

  let at = 500
  for (let s = 0; s < stepCount; s++) {
    const winner = Math.floor(Math.random() * BRANCH_COUNT)
    const winnerScore = 75 + Math.floor(Math.random() * 25)

    for (let b = 0; b < BRANCH_COUNT; b++) {
      timers.push(setTimeout(() => markBranchRunning("demo", s, b), at + b * 180))
      if (b === winner) continue
      const ok = Math.random() > 0.4
      // losers always score below the winner so the star makes sense
      const score = 40 + Math.floor(Math.random() * 35)
      const finish = at + 900 + Math.random() * 900
      timers.push(
        setTimeout(() => {
          if (ok) markBranchDone("demo", s, b, score)
          else markBranchFailed("demo", s, b, "Failed verification")
        }, finish),
      )
    }

    at += 2400
    timers.push(setTimeout(() => advanceStep("demo", s, winner, winnerScore, `Score ${winnerScore}%`), at - 200))
  }
}
