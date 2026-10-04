import { Client } from 'pg'
import { env } from '@/lib/env'

/**
 * Cross-replica event bus on Postgres LISTEN/NOTIFY.
 *
 * Every replica subscribes to one channel. Writes publish small invalidation
 * messages; the payload is also delivered locally so a single replica behaves the
 * same with or without a listener connection.
 */
export type HalyardEvent =
  | { type: 'ruleset.invalidate'; projectId: string; environmentId?: string }
  | { type: 'apikey.invalidate' }
  | { type: 'webhook.enqueued' }
  | { type: 'schedule.changed' }

type Handler = (event: HalyardEvent) => void

const CHANNEL = 'halyard_events'
const handlers = new Set<Handler>()
let listener: Client | undefined
let listening: Promise<void> | undefined
const instanceId = crypto.randomUUID()

export function subscribe(handler: Handler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

function dispatch(event: HalyardEvent) {
  for (const handler of handlers) {
    try {
      handler(event)
    } catch (error) {
      console.error('event handler failed', error)
    }
  }
}

/** Starts the LISTEN connection. Idempotent; reconnects with backoff on failure. */
export function startEventListener(): Promise<void> {
  if (listening) return listening
  listening = (async () => {
    let delay = 500
    for (;;) {
      try {
        const client = new Client({ connectionString: env().DATABASE_URL })
        await client.connect()
        client.on('notification', (message) => {
          if (!message.payload) return
          try {
            const parsed = JSON.parse(message.payload) as { origin: string; event: HalyardEvent }
            if (parsed.origin === instanceId) return
            dispatch(parsed.event)
          } catch (error) {
            console.error('malformed event payload', error)
          }
        })
        client.on('error', (error) => {
          console.error('event listener connection lost', error)
          listener = undefined
          listening = undefined
          void startEventListener()
        })
        await client.query(`LISTEN ${CHANNEL}`)
        listener = client
        return
      } catch (error) {
        console.error(`event listener failed to connect, retrying in ${delay}ms`, error)
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 10_000)
      }
    }
  })()
  return listening
}

export async function stopEventListener(): Promise<void> {
  await listener?.end()
  listener = undefined
  listening = undefined
}

/**
 * Publishes an event to all replicas (including this one). Accepts an executor so
 * events can be sent inside the transaction that caused them; Postgres delivers the
 * notification only when the transaction commits.
 */
export async function publish(
  event: HalyardEvent,
  executor: { execute: (query: import('drizzle-orm').SQL) => Promise<unknown> },
): Promise<void> {
  const { sql } = await import('drizzle-orm')
  const payload = JSON.stringify({ origin: instanceId, event })
  await executor.execute(sql`select pg_notify(${CHANNEL}, ${payload})`)
  dispatch(event)
}
