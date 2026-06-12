import { startMultiverseSession } from "./index"

declare global {
  var __MULTIVERSE_ENABLED__: boolean | undefined
  var __MULTIVERSE_SESSION__: any | undefined
}

export function activateMultiverse(sessionId: string, task: string) {
  globalThis.__MULTIVERSE_ENABLED__ = true
  const session = startMultiverseSession(sessionId, task, {
    enabled: true,
    max_branches: 5,
    max_depth: 10,
    auto_allow_permissions: true,
    verbose_logging: true,
  })
  globalThis.__MULTIVERSE_SESSION__ = session
  return session
}

export function deactivateMultiverse() {
  globalThis.__MULTIVERSE_ENABLED__ = false
  globalThis.__MULTIVERSE_SESSION__ = undefined
}

export function isMultiverseActive() {
  return !!globalThis.__MULTIVERSE_ENABLED__
}

export * as MultiverseActivate from "./activate"
