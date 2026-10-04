/**
 * Retry helper for the database connection at startup. Self-hosted setups
 * frequently start the app before Postgres accepts TCP connections (Compose
 * marks Postgres healthy while it is still restarting after init), so the
 * first connection attempts are retried for a bounded time instead of
 * crashing the process.
 */

const TRANSIENT_CODES = new Set([
  // socket level
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EPIPE',
  // Postgres: cannot_connect_now (starting up / shutting down), connection exceptions
  '57P03',
  '08000',
  '08003',
  '08006',
])

/** True when the error (or one of its causes) is a connection problem worth retrying. */
export function isTransientConnectionError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export interface RetryOptions {
  /** Total time budget in milliseconds. */
  timeoutMs?: number
  /** Delay before the second attempt; doubles on every retry. */
  initialDelayMs?: number
  /** Upper bound for the delay between attempts. */
  maxDelayMs?: number
  /** Called before every retry with the error and the delay that follows. */
  onRetry?: (error: unknown, delayMs: number) => void
  /** Injected for tests. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Runs `operation`, retrying transient connection errors with exponential
 * backoff until it succeeds or the time budget is spent. Non-transient errors
 * are rethrown immediately.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    timeoutMs = 60_000,
    initialDelayMs = 1_000,
    maxDelayMs = 5_000,
    onRetry,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options
  const start = now()
  let delay = initialDelayMs
  for (;;) {
    try {
      return await operation()
    } catch (error) {
      if (!isTransientConnectionError(error)) throw error
      const elapsed = now() - start
      if (elapsed + delay > timeoutMs) throw error
      onRetry?.(error, delay)
      await sleep(delay)
      delay = Math.min(delay * 2, maxDelayMs)
    }
  }
}
