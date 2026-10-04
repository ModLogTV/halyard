import { pruneEvaluationHistory } from '@/server/services/analytics'
import { createPoller, type Poller } from './poller'

/** Hourly buckets age out one hour at a time, so pruning hourly keeps each run small. */
const INTERVAL_MS = 60 * 60 * 1000
const BATCH_SIZE = 10_000

let poller: Poller | undefined

/** Deletes evaluation history older than the retention window. Safe on every replica. */
export function startHistoryPruner(): void {
  if (poller) return
  poller = createPoller({
    name: 'history pruner',
    intervalMs: INTERVAL_MS,
    events: [],
    tick: async () => (await pruneEvaluationHistory(new Date(), BATCH_SIZE)) >= BATCH_SIZE,
  })
  poller.start()
}

export async function stopHistoryPruner(): Promise<void> {
  const current = poller
  poller = undefined
  await current?.stop()
}
