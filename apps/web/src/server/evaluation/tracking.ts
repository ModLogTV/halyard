import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/db'

/**
 * Buffers evaluation activity in memory and writes it to Postgres in batches, so the
 * evaluation path never waits on the database.
 *
 * Evaluation stats are aggregated per (flag, environment) and written with a single
 * upsert per flush. The evaluation history for the analytics charts is counted per
 * (flag, environment, hour, variant) and added to the stored hourly buckets. Experiment exposures are deduplicated per (experiment, subject)
 * and inserted with `on conflict do nothing`. A flush runs every few seconds, and
 * early when a buffer grows past {@link FLUSH_THRESHOLD}. Buffers are capped; when a
 * cap is reached new data is dropped with a (throttled) warning instead of growing
 * memory without bound.
 */
const FLUSH_INTERVAL_MS = 5_000
const FLUSH_THRESHOLD = 10_000
const MAX_STAT_ENTRIES = 50_000
const MAX_EXPOSURE_ENTRIES = 100_000
const MAX_BUCKET_ENTRIES = 50_000
const HOUR_MS = 3_600_000
const EXPOSURE_BATCH_SIZE = 5_000
const WARN_INTERVAL_MS = 60_000

/**
 * Aggregated activity of one flag in one environment during one window.
 *
 * `lastVariant` / `firstVariant` / `runStart` / `mixed` ignore `ERROR` evaluations,
 * which do not serve a variant. `runStart` is the time of the first evaluation of
 * the run of `lastVariant` that the window ends with, i.e. within the window every
 * evaluation since `runStart` returned `lastVariant`.
 */
interface StatEntry {
  flagId: string
  environmentId: string
  count: number
  lastEvaluatedAt: number
  firstVariant: string | null
  lastVariant: string | null
  runStart: number
  /** True when the window saw more than one distinct variant. */
  mixed: boolean
}

/** Evaluations of one variant of one flag in one environment during one hour. */
interface BucketEntry {
  flagId: string
  environmentId: string
  /** Start of the hour, epoch milliseconds. */
  bucketStart: number
  /** Served variant; empty for `ERROR` results. */
  variant: string
  count: number
}

interface ExposureEntry {
  experimentId: string
  subjectHash: string
  variant: string
  firstSeenAt: number
}

interface TrackingState {
  stats: Map<string, StatEntry>
  buckets: Map<string, BucketEntry>
  exposures: Map<string, ExposureEntry>
  flushing: Promise<void> | undefined
  timer: ReturnType<typeof setInterval> | undefined
  lastWarning: number
}

declare global {
  // Shared across Vite HMR reloads so a reload neither loses buffered data nor starts a second timer.
  var __halyardTracking: TrackingState | undefined
}

globalThis.__halyardTracking ??= {
  stats: new Map(),
  buckets: new Map(),
  exposures: new Map(),
  flushing: undefined,
  timer: undefined,
  lastWarning: 0,
}
// A state created before the evaluation history existed survives HMR without buckets.
globalThis.__halyardTracking.buckets ??= new Map()
const state = globalThis.__halyardTracking

/**
 * Hash identifying an experiment subject: hex SHA-256 of the targeting key. The
 * tracking (conversion) endpoint must use the same function so exposures and
 * conversions join.
 */
export function subjectHash(targetingKey: string): string {
  return createHash('sha256').update(targetingKey).digest('hex')
}

function warnDropped(what: string): void {
  const now = Date.now()
  if (now - state.lastWarning < WARN_INTERVAL_MS) return
  state.lastWarning = now
  console.warn(`evaluation tracking buffer full, dropping ${what} until the next flush succeeds`)
}

function recordBucket(flagId: string, environmentId: string, variant: string, now: number): void {
  const bucketStart = now - (now % HOUR_MS)
  const key = `${flagId}:${environmentId}:${bucketStart}:${variant}`
  const entry = state.buckets.get(key)
  if (entry) {
    entry.count += 1
    return
  }
  if (state.buckets.size >= MAX_BUCKET_ENTRIES) {
    warnDropped('evaluation history')
    return
  }
  state.buckets.set(key, { flagId, environmentId, bucketStart, variant, count: 1 })
  if (state.buckets.size >= FLUSH_THRESHOLD) void flushTracking()
}

/**
 * Records one evaluation of a flag. `variant` is undefined for `ERROR` results.
 * Synchronous and allocation-light; never touches the database.
 */
export function recordEvaluation(
  flagId: string,
  environmentId: string,
  variant: string | undefined,
  now = Date.now(),
): void {
  recordBucket(flagId, environmentId, variant ?? '', now)
  const key = `${flagId}:${environmentId}`
  const entry = state.stats.get(key)
  const served = variant ?? null
  if (!entry) {
    if (state.stats.size >= MAX_STAT_ENTRIES) {
      warnDropped('evaluation stats')
      return
    }
    state.stats.set(key, {
      flagId,
      environmentId,
      count: 1,
      lastEvaluatedAt: now,
      firstVariant: served,
      lastVariant: served,
      runStart: now,
      mixed: false,
    })
    if (state.stats.size >= FLUSH_THRESHOLD) void flushTracking()
    return
  }
  entry.count += 1
  if (now > entry.lastEvaluatedAt) entry.lastEvaluatedAt = now
  if (served === null) return
  if (entry.lastVariant === null) {
    // Only errors so far in this window: this is the first served variant.
    entry.firstVariant = served
    entry.lastVariant = served
    entry.runStart = now
  } else if (entry.lastVariant !== served) {
    entry.mixed = true
    entry.lastVariant = served
    entry.runStart = now
  }
}

/** Records that a subject was allocated to an experiment variant. The first allocation wins. */
export function recordExposure(
  experimentId: string,
  targetingKey: string,
  variant: string,
  now = Date.now(),
): void {
  const hash = subjectHash(targetingKey)
  const key = `${experimentId}:${hash}`
  if (state.exposures.has(key)) return
  if (state.exposures.size >= MAX_EXPOSURE_ENTRIES) {
    warnDropped('experiment exposures')
    return
  }
  state.exposures.set(key, { experimentId, subjectHash: hash, variant, firstSeenAt: now })
  if (state.exposures.size >= FLUSH_THRESHOLD) void flushTracking()
}

/** Combines an older window (that failed to flush) with the newer one recorded meanwhile. */
function mergeStat(older: StatEntry, newer: StatEntry): StatEntry {
  const merged: StatEntry = {
    ...older,
    count: older.count + newer.count,
    lastEvaluatedAt: Math.max(older.lastEvaluatedAt, newer.lastEvaluatedAt),
  }
  if (newer.lastVariant === null) return merged
  if (older.lastVariant === null) {
    return {
      ...merged,
      firstVariant: newer.firstVariant,
      lastVariant: newer.lastVariant,
      runStart: newer.runStart,
      mixed: newer.mixed,
    }
  }
  const changed = newer.mixed || newer.firstVariant !== older.lastVariant
  return {
    ...merged,
    lastVariant: newer.lastVariant,
    runStart: changed ? newer.runStart : older.runStart,
    mixed: older.mixed || changed,
  }
}

function requeueStats(failed: Map<string, StatEntry>): void {
  for (const [key, older] of failed) {
    const newer = state.stats.get(key)
    if (newer) state.stats.set(key, mergeStat(older, newer))
    else if (state.stats.size < MAX_STAT_ENTRIES) state.stats.set(key, older)
    else warnDropped('evaluation stats')
  }
}

function requeueBuckets(failed: Map<string, BucketEntry>): void {
  for (const [key, older] of failed) {
    const newer = state.buckets.get(key)
    if (newer) newer.count += older.count
    else if (state.buckets.size < MAX_BUCKET_ENTRIES) state.buckets.set(key, older)
    else warnDropped('evaluation history')
  }
}

function requeueExposures(failed: ExposureEntry[]): void {
  for (const exposure of failed) {
    const key = `${exposure.experimentId}:${exposure.subjectHash}`
    // The failed entry is the earlier allocation, so it replaces a newer duplicate.
    if (state.exposures.has(key) || state.exposures.size < MAX_EXPOSURE_ENTRIES) {
      state.exposures.set(key, exposure)
    } else {
      warnDropped('experiment exposures')
      return
    }
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Writes the stats of one window with a single upsert.
 *
 * `same_variant_since` is the time since which every evaluation returned
 * `last_variant`:
 * - the window served only errors: keep the stored values;
 * - the window is older than the stored state (another replica flushed a later
 *   window first): the stored variant run cannot have started before this window
 *   ended if the variants differ, so move the start forward at most;
 * - otherwise, when the stored variant differs from the window's or the window saw
 *   several variants, the run started at the window's `runStart`; else keep it.
 */
async function writeStats(entries: StatEntry[]): Promise<void> {
  const flagIds = entries.map((e) => e.flagId)
  const environmentIds = entries.map((e) => e.environmentId)
  const lastEvaluatedAt = entries.map((e) => iso(e.lastEvaluatedAt))
  const variants = entries.map((e) => e.lastVariant)
  const since = entries.map((e) => iso(e.runStart))
  const counts = entries.map((e) => e.count)
  const mixed = entries.map((e) => e.mixed)

  await db.execute(sql`
    with input as (
      select * from unnest(
        ${sql.param(flagIds)}::uuid[],
        ${sql.param(environmentIds)}::uuid[],
        ${sql.param(lastEvaluatedAt)}::timestamptz[],
        ${sql.param(variants)}::text[],
        ${sql.param(since)}::timestamptz[],
        ${sql.param(counts)}::bigint[],
        ${sql.param(mixed)}::boolean[]
      ) as i(flag_id, environment_id, last_evaluated_at, last_variant, same_variant_since, evaluation_count, mixed)
    )
    insert into flag_evaluation_stats as s
      (flag_id, environment_id, last_evaluated_at, last_variant, same_variant_since, evaluation_count)
    select i.flag_id, i.environment_id, i.last_evaluated_at, i.last_variant, i.same_variant_since, i.evaluation_count
    from input i
    -- Flags or environments deleted since the evaluation would fail the whole batch.
    where exists (select 1 from flags f where f.id = i.flag_id)
      and exists (select 1 from environments e where e.id = i.environment_id)
    on conflict (flag_id, environment_id) do update set
      evaluation_count = s.evaluation_count + excluded.evaluation_count,
      last_evaluated_at = greatest(s.last_evaluated_at, excluded.last_evaluated_at),
      last_variant = case
        when excluded.last_variant is null or excluded.last_evaluated_at < s.last_evaluated_at
          then s.last_variant
        else excluded.last_variant
      end,
      same_variant_since = case
        when excluded.last_variant is null then s.same_variant_since
        when excluded.last_evaluated_at < s.last_evaluated_at then case
          when excluded.last_variant is distinct from s.last_variant
            then greatest(s.same_variant_since, excluded.last_evaluated_at)
          when (select i.mixed from input i
                where i.flag_id = excluded.flag_id and i.environment_id = excluded.environment_id)
            then greatest(s.same_variant_since, excluded.same_variant_since)
          else s.same_variant_since
        end
        when s.last_variant is distinct from excluded.last_variant
          or (select i.mixed from input i
              where i.flag_id = excluded.flag_id and i.environment_id = excluded.environment_id)
          then excluded.same_variant_since
        else s.same_variant_since
      end
  `)
}

/** Adds the counts of one window to the stored hourly buckets. */
async function writeBuckets(entries: BucketEntry[]): Promise<void> {
  await db.execute(sql`
    insert into flag_evaluation_buckets as b (flag_id, environment_id, bucket_start, variant, count)
    select i.flag_id, i.environment_id, i.bucket_start, i.variant, i.count
    from unnest(
      ${sql.param(entries.map((e) => e.flagId))}::uuid[],
      ${sql.param(entries.map((e) => e.environmentId))}::uuid[],
      ${sql.param(entries.map((e) => iso(e.bucketStart)))}::timestamptz[],
      ${sql.param(entries.map((e) => e.variant))}::text[],
      ${sql.param(entries.map((e) => e.count))}::bigint[]
    ) as i(flag_id, environment_id, bucket_start, variant, count)
    -- Flags or environments deleted since the evaluation would fail the whole batch.
    where exists (select 1 from flags f where f.id = i.flag_id)
      and exists (select 1 from environments e where e.id = i.environment_id)
    on conflict (flag_id, environment_id, bucket_start, variant) do update set
      count = b.count + excluded.count
  `)
}

async function writeExposures(entries: ExposureEntry[]): Promise<void> {
  await db.execute(sql`
    insert into experiment_exposures (experiment_id, subject_hash, variant, first_seen_at)
    select i.experiment_id, i.subject_hash, i.variant, i.first_seen_at
    from unnest(
      ${sql.param(entries.map((e) => e.experimentId))}::uuid[],
      ${sql.param(entries.map((e) => e.subjectHash))}::text[],
      ${sql.param(entries.map((e) => e.variant))}::text[],
      ${sql.param(entries.map((e) => iso(e.firstSeenAt)))}::timestamptz[]
    ) as i(experiment_id, subject_hash, variant, first_seen_at)
    where exists (select 1 from experiments x where x.id = i.experiment_id)
    on conflict do nothing
  `)
}

async function flushOnce(): Promise<void> {
  const stats = state.stats
  const buckets = state.buckets
  const exposures = state.exposures
  if (stats.size === 0 && buckets.size === 0 && exposures.size === 0) return
  state.stats = new Map()
  state.buckets = new Map()
  state.exposures = new Map()

  if (stats.size > 0) {
    try {
      await writeStats([...stats.values()])
    } catch (error) {
      console.error('failed to flush evaluation stats, retrying with the next flush', error)
      requeueStats(stats)
    }
  }

  if (buckets.size > 0) {
    try {
      await writeBuckets([...buckets.values()])
    } catch (error) {
      console.error('failed to flush evaluation history, retrying with the next flush', error)
      requeueBuckets(buckets)
    }
  }

  const pending = [...exposures.values()]
  for (let offset = 0; offset < pending.length; offset += EXPOSURE_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + EXPOSURE_BATCH_SIZE)
    try {
      await writeExposures(batch)
    } catch (error) {
      console.error('failed to flush experiment exposures, retrying with the next flush', error)
      requeueExposures(pending.slice(offset))
      break
    }
  }
}

/**
 * Writes all buffered data. Concurrent calls share the running flush and then flush
 * whatever was recorded meanwhile. Never throws.
 */
export async function flushTracking(): Promise<void> {
  while (state.flushing) await state.flushing
  const run = flushOnce()
    .catch((error) => console.error('evaluation tracking flush failed', error))
    .finally(() => {
      state.flushing = undefined
    })
  state.flushing = run
  await run
}

/** Starts the periodic flush. Idempotent. */
export function startTrackingFlusher(): void {
  if (state.timer) return
  state.timer = setInterval(() => void flushTracking(), FLUSH_INTERVAL_MS)
  state.timer.unref?.()
}

/** Stops the periodic flush and writes what is buffered. */
export async function stopTrackingFlusher(): Promise<void> {
  if (state.timer) clearInterval(state.timer)
  state.timer = undefined
  await flushTracking()
}

/** Drops buffered data without writing it. For tests. */
export function resetTracking(): void {
  state.stats.clear()
  state.buckets.clear()
  state.exposures.clear()
}

/** Number of buffered entries, for tests and diagnostics. */
export function trackingBufferSize(): { stats: number; buckets: number; exposures: number } {
  return { stats: state.stats.size, buckets: state.buckets.size, exposures: state.exposures.size }
}
