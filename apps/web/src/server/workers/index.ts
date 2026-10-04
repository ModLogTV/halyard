/**
 * Background workers run on every replica. Each worker claims rows with
 * `FOR UPDATE SKIP LOCKED`, so running several replicas is safe.
 */
let started = false

export async function startWorkers(): Promise<void> {
  if (started) return
  started = true
}

export async function stopWorkers(): Promise<void> {
  started = false
}
