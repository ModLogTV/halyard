import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { experiments } from '@/db/schema'
import { subjectHash } from '@/server/evaluation/tracking'

/**
 * Attributes conversion events to experiment exposures.
 *
 * A conversion counts for every RUNNING experiment in the environment whose
 * `conversionEvent` equals the event name and in which the subject (hashed targeting
 * key) has an exposure. It is stored with the exposed variant; only the first
 * conversion per (experiment, subject) is kept (`on conflict do nothing`).
 *
 * Exposures are buffered by the evaluation path (`tracking.ts`) and written every few
 * seconds, so a conversion can arrive before its exposure is in Postgres. Such
 * conversions are kept in a bounded in-memory pending list and re-checked every
 * {@link RETRY_INTERVAL_MS} and on the next {@link recordConversions} call, for at
 * most {@link PENDING_TTL_MS}. Pending conversions are lost when the process exits.
 */
export const PENDING_TTL_MS = 60_000
export const MAX_PENDING_CONVERSIONS = 10_000
export const RETRY_INTERVAL_MS = 5_000
const WARN_INTERVAL_MS = 60_000

export interface ConversionEvent {
  event: string
  targetingKey: string
  /** When the conversion happened; defaults to now. Future times are clamped to now. */
  occurredAt?: Date
}

export interface RecordConversionsResult {
  /** (event, experiment) pairs attributed to an existing exposure, repeats included. */
  matched: number
  /** (event, experiment) pairs without an exposure yet, kept for a retry. */
  pending: number
}

interface Candidate {
  experimentId: string
  subjectHash: string
  convertedAt: number
}

interface PendingConversion extends Candidate {
  expiresAt: number
}

interface PendingState {
  entries: Map<string, PendingConversion>
  timer: ReturnType<typeof setInterval> | undefined
  retrying: Promise<void> | undefined
  lastRetry: number
  lastWarning: number
}

declare global {
  // Shared across Vite HMR reloads, like the tracking buffers.
  var __halyardPendingConversions: PendingState | undefined
}

globalThis.__halyardPendingConversions ??= {
  entries: new Map(),
  timer: undefined,
  retrying: undefined,
  lastRetry: 0,
  lastWarning: 0,
}
const state = globalThis.__halyardPendingConversions

const keyOf = (c: Pick<Candidate, 'experimentId' | 'subjectHash'>) =>
  `${c.experimentId}:${c.subjectHash}`

/**
 * Inserts a conversion for every candidate whose subject has an exposure in the
 * experiment, using the exposed variant. Returns the keys of the candidates that had
 * an exposure (whether or not a conversion already existed).
 */
async function attribute(candidates: Candidate[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set()
  const result = await db.execute<{ experiment_id: string; subject_hash: string }>(sql`
    with input as (
      select * from unnest(
        ${sql.param(candidates.map((c) => c.experimentId))}::uuid[],
        ${sql.param(candidates.map((c) => c.subjectHash))}::text[],
        ${sql.param(candidates.map((c) => new Date(c.convertedAt).toISOString()))}::timestamptz[]
      ) as i(experiment_id, subject_hash, converted_at)
    ),
    found as (
      select distinct on (i.experiment_id, i.subject_hash)
        i.experiment_id, i.subject_hash, x.variant, i.converted_at
      from input i
      join experiment_exposures x
        on x.experiment_id = i.experiment_id and x.subject_hash = i.subject_hash
      order by i.experiment_id, i.subject_hash, i.converted_at
    ),
    inserted as (
      insert into experiment_conversions (experiment_id, subject_hash, variant, converted_at)
      select experiment_id, subject_hash, variant, converted_at from found
      on conflict do nothing
      returning 1
    )
    select experiment_id, subject_hash from found
  `)
  return new Set(result.rows.map((row) => `${row.experiment_id}:${row.subject_hash}`))
}

function warnFull(): void {
  const now = Date.now()
  if (now - state.lastWarning < WARN_INTERVAL_MS) return
  state.lastWarning = now
  console.warn('pending conversion buffer full, dropping conversions without an exposure')
}

function addPending(candidate: Candidate, now: number): boolean {
  const key = keyOf(candidate)
  const existing = state.entries.get(key)
  if (existing) {
    // The earliest conversion is the one that counts.
    if (candidate.convertedAt < existing.convertedAt) existing.convertedAt = candidate.convertedAt
    return true
  }
  if (state.entries.size >= MAX_PENDING_CONVERSIONS) {
    warnFull()
    return false
  }
  state.entries.set(key, { ...candidate, expiresAt: now + PENDING_TTL_MS })
  ensureTimer()
  return true
}

function ensureTimer(): void {
  if (state.timer) return
  state.timer = setInterval(() => void retryPendingConversions(), RETRY_INTERVAL_MS)
  state.timer.unref?.()
}

function stopTimer(): void {
  if (state.timer) clearInterval(state.timer)
  state.timer = undefined
}

async function retryOnce(now: number): Promise<void> {
  state.lastRetry = now
  for (const [key, entry] of state.entries) {
    if (entry.expiresAt <= now) state.entries.delete(key)
  }
  const entries = [...state.entries.values()]
  if (entries.length > 0) {
    const found = await attribute(entries)
    for (const key of found) state.entries.delete(key)
  }
  if (state.entries.size === 0) stopTimer()
}

/**
 * Re-checks pending conversions against the exposures in Postgres, recording those
 * that now match and dropping those older than {@link PENDING_TTL_MS}. Concurrent
 * calls share one run. Never throws.
 */
export async function retryPendingConversions(now = Date.now()): Promise<void> {
  if (state.retrying) return state.retrying
  const run = retryOnce(now)
    .catch((error) => console.error('retrying pending conversions failed', error))
    .finally(() => {
      state.retrying = undefined
    })
  state.retrying = run
  return run
}

/**
 * Records conversion events for one environment. See the module comment for the
 * attribution rules.
 */
export async function recordConversions(input: {
  projectId: string
  environmentId: string
  events: ConversionEvent[]
  now?: number
}): Promise<RecordConversionsResult> {
  const now = input.now ?? Date.now()
  if (state.entries.size > 0 && now - state.lastRetry >= RETRY_INTERVAL_MS) {
    void retryPendingConversions(now)
  }

  const names = [...new Set(input.events.map((e) => e.event))]
  if (names.length === 0) return { matched: 0, pending: 0 }
  const running = await db
    .select({ id: experiments.id, conversionEvent: experiments.conversionEvent })
    .from(experiments)
    .where(
      and(
        eq(experiments.projectId, input.projectId),
        eq(experiments.environmentId, input.environmentId),
        eq(experiments.status, 'running'),
        inArray(experiments.conversionEvent, names),
      ),
    )
  if (running.length === 0) return { matched: 0, pending: 0 }

  const candidates: Candidate[] = []
  for (const event of input.events) {
    const hash = subjectHash(event.targetingKey)
    const occurred = event.occurredAt?.getTime()
    const convertedAt = occurred === undefined || occurred > now ? now : occurred
    for (const experiment of running) {
      if (experiment.conversionEvent !== event.event) continue
      candidates.push({ experimentId: experiment.id, subjectHash: hash, convertedAt })
    }
  }

  const found = await attribute(candidates)
  let matched = 0
  let pending = 0
  for (const candidate of candidates) {
    if (found.has(keyOf(candidate))) matched += 1
    else if (addPending(candidate, now)) pending += 1
  }
  return { matched, pending }
}

/** Number of conversions waiting for their exposure, for tests and diagnostics. */
export function pendingConversionCount(): number {
  return state.entries.size
}

/** Drops pending conversions and stops the retry timer. For tests. */
export function resetPendingConversions(): void {
  state.entries.clear()
  state.lastRetry = 0
  stopTimer()
}
