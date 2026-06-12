export interface VerificationResult {
  passed: boolean
  score: number
  reasoning: string
  issues: string[]
}

export function verifyResult(
  successMetric: string,
  result: string,
  toolOutputs: string[],
): VerificationResult {
  const issues: string[] = []
  let score = 70

  if (result.toLowerCase().includes("error") || result.toLowerCase().includes("failed")) {
    issues.push("Result contains error/failure indicators")
    score -= 30
  }

  if (
    toolOutputs.some(
      (o) =>
        o.toLowerCase().includes("error") ||
        o.toLowerCase().includes("eexist") ||
        o.toLowerCase().includes("enoent"),
    )
  ) {
    issues.push("Tool outputs contain errors")
    score -= 20
  }

  if (result.length < 50) {
    issues.push("Result is too brief - may be incomplete")
    score -= 20
  }

  if (
    result.toLowerCase().includes("success") ||
    result.toLowerCase().includes("completed") ||
    result.toLowerCase().includes("done")
  ) {
    score += 15
  }

  if (toolOutputs.length > 0 && !toolOutputs.some((o) => o.toLowerCase().includes("error"))) {
    score += 10
  }

  score = Math.max(0, Math.min(100, score))

  const metricWords = successMetric.toLowerCase().split(/\s+/)
  const resultLower = result.toLowerCase()
  const matchedWords = metricWords.filter((w) => w.length > 3 && resultLower.includes(w))
  if (matchedWords.length > 0) {
    score += matchedWords.length * 3
  }

  const finalScore = Math.min(100, score)

  return {
    passed: finalScore >= 50,
    score: finalScore,
    reasoning:
      finalScore >= 70
        ? "Result meets success criteria"
        : finalScore >= 50
          ? "Result partially meets criteria"
          : "Result does not meet success criteria",
    issues,
  }
}

export * as Verifier from "./verifier"
