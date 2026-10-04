import { env } from '@/lib/env'
import { runMigrations } from '@/server/db/migrate'
import { withRetry } from '@/server/db/retry'

declare global {
  var __halyardBootstrap: Promise<void> | undefined
}

async function start(): Promise<void> {
  const config = env()
  if (config.RUN_MIGRATIONS_ON_STARTUP && config.NODE_ENV !== 'test') {
    // Postgres may still be starting when the container comes up; wait for it.
    await withRetry(runMigrations, {
      timeoutMs: config.DATABASE_CONNECT_TIMEOUT_MS,
      onRetry: (error, delayMs) => {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
        console.warn(`Database not reachable yet (${message}); retrying in ${delayMs} ms`)
      },
    })
  }
  if (config.ENABLE_WORKERS && config.NODE_ENV !== 'test') {
    const { startWorkers } = await import('@/server/workers')
    await startWorkers()
  }
}

/** Runs once per process (and survives HMR in development). */
export function bootstrap(): Promise<void> {
  if (!globalThis.__halyardBootstrap) {
    globalThis.__halyardBootstrap = start().catch((error) => {
      globalThis.__halyardBootstrap = undefined
      throw error
    })
  }
  return globalThis.__halyardBootstrap
}
