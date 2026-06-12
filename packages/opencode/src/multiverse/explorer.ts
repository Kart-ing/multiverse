export interface Approach {
  index: number
  label: string
  strategy: string
  prompt: string
}

export function generateApproaches(
  step: string,
  successMetric: string,
  maxBranches: number = 5,
): Approach[] {
  const approaches: Approach[] = [
    {
      index: 0,
      label: "Direct",
      strategy: "Simple, straightforward implementation",
      prompt: `Complete this step directly and efficiently: ${step}. The success metric is: ${successMetric}. Write clean, working code.`,
    },
    {
      index: 1,
      label: "Modular",
      strategy: "Break into smaller reusable modules",
      prompt: `Complete this step using a modular approach, breaking the work into small, reusable pieces: ${step}. The success metric is: ${successMetric}. Focus on clean abstraction and composability.`,
    },
    {
      index: 2,
      label: "Minimal",
      strategy: "Minimal viable approach, fewest changes",
      prompt: `Complete this step with the minimal changes necessary: ${step}. The success metric is: ${successMetric}. Prefer simplicity and minimal code.`,
    },
    {
      index: 3,
      label: "Robust",
      strategy: "Defensive, handles all edge cases",
      prompt: `Complete this step with comprehensive error handling and edge case coverage: ${step}. The success metric is: ${successMetric}. Handle every possible failure mode.`,
    },
    {
      index: 4,
      label: "Creative",
      strategy: "Novel, outside-the-box approach",
      prompt: `Complete this step using a creative, unconventional approach: ${step}. The success metric is: ${successMetric}. Think differently and try novel patterns.`,
    },
  ]

  return approaches.slice(0, maxBranches)
}

export function getComposioTools(approach: string): string[] {
  switch (approach) {
    case "Direct": return ["bash", "file_write", "edit"]
    case "Modular": return ["file_read", "file_write", "glob", "grep"]
    case "Minimal": return ["edit", "file_write"]
    case "Robust": return ["bash", "file_read", "file_write", "edit", "grep"]
    case "Creative": return ["bash", "file_read", "file_write"]
    default: return ["bash", "file_write", "edit"]
  }
}

export function getApproachProvider(_approach: Approach): string {
  return "pioneer"
}

export * as Explorer from "./explorer"
