import { type HalyardEvent, subscribe } from '@/server/events'

export interface PollerOptions {
  name: string
  intervalMs: number
  /** Events that trigger an early run (debounced by `debounceMs`). */
  events: HalyardEvent['type'][]
  debounceMs?: number
  /** Processes one batch. Returns true when there may be more work right away. */
  tick: () => Promise<boolean>
}

export interface Poller {
  start(): void
  /** Stops the timers and waits for a run in progress. */
  stop(): Promise<void>
  /** Schedules a debounced run. */
  trigger(): void
  /** Runs now (or joins the run in progress, followed by one more run). */
  run(): Promise<void>
}

/** Upper bound on back-to-back batches per run, so one run cannot monopolise the process. */
const MAX_BATCHES_PER_RUN = 50

/**
 * A periodic worker loop: runs `tick` every `intervalMs` and shortly after one of
 * `events` arrives. Runs never overlap within a process; across replicas the work
 * itself must be safe to run concurrently (row claims with `SKIP LOCKED`).
 */
export function createPoller(options: PollerOptions): Poller {
  const debounceMs = options.debounceMs ?? 250
  let interval: ReturnType<typeof setInterval> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  let current: Promise<void> | undefined
  let again = false
  let active = false

  async function loop(): Promise<void> {
    do {
      again = false
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
        let more = false
        try {
          more = await options.tick()
        } catch (error) {
          console.error(`${options.name} run failed`, error)
        }
        if (!more || !active) break
      }
    } while (again && active)
  }

  function run(): Promise<void> {
    if (current) {
      again = true
      return current
    }
    current = loop().finally(() => {
      current = undefined
    })
    return current
  }

  function trigger(): void {
    if (!active || debounce) return
    debounce = setTimeout(() => {
      debounce = undefined
      void run()
    }, debounceMs)
    debounce.unref?.()
  }

  return {
    start() {
      if (active) return
      active = true
      interval = setInterval(() => void run(), options.intervalMs)
      interval.unref?.()
      unsubscribe = subscribe((event) => {
        if (options.events.includes(event.type)) trigger()
      })
      void run()
    },
    async stop() {
      active = false
      if (interval) clearInterval(interval)
      if (debounce) clearTimeout(debounce)
      interval = undefined
      debounce = undefined
      unsubscribe?.()
      unsubscribe = undefined
      await current
    },
    trigger,
    run,
  }
}

/** Reads a positive integer from the environment, falling back to `fallback`. */
export function intervalFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`ignoring invalid ${name}=${raw}, using ${fallback}`)
    return fallback
  }
  return Math.floor(value)
}
