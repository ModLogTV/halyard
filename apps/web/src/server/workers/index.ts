import { startTrackingFlusher, stopTrackingFlusher } from '@/server/evaluation/tracking'
import { startEventListener, stopEventListener } from '@/server/events'
import { startScheduler, stopScheduler } from './scheduler'
import { startWebhookDispatcher, stopWebhookDispatcher } from './webhook-dispatcher'

/**
 * Background work that runs on every replica: the cross-replica event listener
 * and the periodic workers. Workers claim rows with `FOR UPDATE SKIP LOCKED`, so
 * running several replicas is safe.
 */
let started = false

export async function startWorkers(): Promise<void> {
  if (started) return
  started = true
  await startEventListener()
  startTrackingFlusher()
  startScheduler()
  startWebhookDispatcher()
}

export async function stopWorkers(): Promise<void> {
  started = false
  await Promise.all([stopScheduler(), stopWebhookDispatcher()])
  await stopEventListener()
  await stopTrackingFlusher()
}
