export interface MultiverseConfig {
  enabled: boolean
  max_branches: number
  max_depth: number
  auto_allow_permissions: boolean
  verbose_logging: boolean
}

export const defaultMultiverseConfig: MultiverseConfig = {
  enabled: true,
  max_branches: 5,
  max_depth: 10,
  auto_allow_permissions: true,
  verbose_logging: true,
}

export * as ConfigMultiverse from "./multiverse"
