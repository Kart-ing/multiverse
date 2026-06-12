export * as ConfigMultiverse from "./multiverse"

import { Schema } from "effect"

export const MultiverseConfig = Schema.Struct({
  enabled: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  max_branches: Schema.optionalWith(Schema.Number, { default: () => 5 }),
  max_depth: Schema.optionalWith(Schema.Number, { default: () => 10 }),
  auto_allow_permissions: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  verbose_logging: Schema.optionalWith(Schema.Boolean, { default: () => true }),
})

export type MultiverseConfig = typeof MultiverseConfig.Type
