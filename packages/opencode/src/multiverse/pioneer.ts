export interface PioneerConfig {
  api_key: string
  base_url: string
  model: string
  enabled: boolean
}

let pioneerConfig: PioneerConfig | null = null

export function initPioneer(config: PioneerConfig) {
  pioneerConfig = config
  console.log(`[Pioneer] Initialized with model ${config.model}`)
}

export function isPioneerEnabled(): boolean {
  return pioneerConfig?.enabled && !!pioneerConfig?.api_key
}

export async function pioneerCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; max_tokens?: number },
): Promise<string | null> {
  if (!pioneerConfig?.enabled || !pioneerConfig.api_key) return null

  try {
    const response = await fetch(`${pioneerConfig.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${pioneerConfig.api_key}`,
        "Content-Type": "application/json",
        "X-Source": "multiverse-decision-tree",
        "X-Sponsor": "pioneer",
      },
      body: JSON.stringify({
        model: pioneerConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 4096,
        metadata: {
          source: "multiverse",
          feature: "decision_tree_branch",
          sponsor: "pioneer",
        },
      }),
    })

    if (!response.ok) {
      console.log(`[Pioneer] API error ${response.status}, falling back`)
      return null
    }

    const data = await response.json() as any
    return data.choices?.[0]?.message?.content ?? null
  } catch (err) {
    console.log(`[Pioneer] Unavailable, using default provider:`, err)
    return null
  }
}

export async function pioneerBranchExploration(
  branches: Array<{ id: string; systemPrompt: string; userPrompt: string }>,
): Promise<Array<{ id: string; result: string | null; provider: string }>> {
  if (!isPioneerEnabled()) {
    return branches.map(b => ({ id: b.id, result: null, provider: "default" }))
  }

  console.log(`[Pioneer] Exploring ${branches.length} branches in parallel`)

  const results = await Promise.allSettled(
    branches.map(async (branch) => {
      const result = await pioneerCompletion(branch.systemPrompt, branch.userPrompt)
      return { id: branch.id, result, provider: "pioneer" }
    }),
  )

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value
    return { id: branches[i].id, result: null, provider: "default" }
  })
}

export function logPioneerUsage(
  numBranches: number,
  totalTokens: number,
  sessionId: string,
) {
  console.log(`[Pioneer::Multiverse] session=${sessionId} branches=${numBranches} tokens=${totalTokens} sponsor=pioneer`)
}

export * as Pioneer from "./pioneer"
