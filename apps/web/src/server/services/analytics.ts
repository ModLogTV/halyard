import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  min,
  sql,
} from 'drizzle-orm'
import { db } from '@/db'
import { environments, flagEvaluationBuckets, flags } from '@/db/schema'
import { notFound } from '@/server/errors'
import {
  type AnalyticsRange,
  type FlagAnalyticsInput,
  flagAnalyticsSchema,
  type ProjectAnalyticsInput,
  projectAnalyticsSchema,
} from '../schemas/analytics'
import { assertProjectAccess, type ProjectActor } from './authz'
import { parseInput } from './util'

/**
 * Basic usage analytics from the hourly evaluation buckets that the tracking flusher
 * writes. The history is short on purpose: long-term analysis belongs in Prometheus
 * (`halyard_evaluations_total`).
 */

const HOUR_MS = 3_600_000

/**
 * How long hourly buckets are kept: twice the longest range, so it can be compared with
 * the period before, plus a day so the 30 day view can start at local midnight in any
 * time zone, plus a day of slack.
 */
export const HISTORY_RETENTION_DAYS = 62

/** Hours summed for the totals, and hours of series returned (30 days get one more day). */
const RANGE_HOURS: Record<AnalyticsRange, { hours: number; seriesHours: number }> = {
  '24h': { hours: 24, seriesHours: 24 },
  '7d': { hours: 7 * 24, seriesHours: 7 * 24 },
  '30d': { hours: 30 * 24, seriesHours: 31 * 24 },
}

const TOP_FLAGS_LIMIT = 8

export interface AnalyticsWindow {
  range: AnalyticsRange
  /** Start of the oldest hour in the totals. */
  from: Date
  /** Server time of the query; the newest hour is still in progress. */
  to: Date
}

export interface ProjectAnalytics {
  window: AnalyticsWindow
  /** `previous` is null when the history does not reach back over the whole previous period. */
  totals: { evaluations: number; previous: number | null }
  /** Non-archived flags, and how many of them were evaluated in the window. */
  flags: { total: number; evaluated: number }
  /** Evaluations per hour, only hours with evaluations. */
  series: { bucketStart: Date; count: number }[]
  topFlags: { key: string; name: string; evaluations: number }[]
}

export interface FlagAnalytics {
  window: AnalyticsWindow
  /** `previous` is null when the history does not reach back over the whole previous period. */
  totals: { evaluations: number; previous: number | null; errors: number }
  /** Evaluations per served variant in the window, most served first; `null` are errors. */
  variants: { variant: string | null; count: number }[]
  /** Evaluations per hour and variant, only hours with evaluations. */
  series: { bucketStart: Date; variant: string | null; count: number }[]
}

function windowFor(range: AnalyticsRange, now: Date) {
  const { hours, seriesHours } = RANGE_HOURS[range]
  const currentHour = now.getTime() - (now.getTime() % HOUR_MS)
  const from = new Date(currentHour - (hours - 1) * HOUR_MS)
  return {
    window: { range, from, to: now },
    previousFrom: new Date(from.getTime() - hours * HOUR_MS),
    seriesFrom: new Date(currentHour - (seriesHours - 1) * HOUR_MS),
  }
}

/** The project's environment ids, or the one requested after checking it belongs to the project. */
async function environmentIds(projectId: string, environmentId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.projectId, projectId),
        environmentId ? eq(environments.id, environmentId) : undefined,
      ),
    )
  if (environmentId && rows.length === 0) throw notFound('Environment')
  return rows.map((row) => row.id)
}

const total = sql<number>`coalesce(sum(${flagEvaluationBuckets.count}), 0)`.mapWith(Number)

/**
 * The sum of the previous period, or null when it would be misleading: the history starts
 * after the previous period began (pruned, or Halyard tracked nothing back then).
 */
async function previousTotal(previousFrom: Date, sum: Promise<{ count: number }[]>) {
  const [[oldest], [previous]] = await Promise.all([
    db.select({ start: min(flagEvaluationBuckets.bucketStart) }).from(flagEvaluationBuckets),
    sum,
  ])
  if (!oldest?.start || oldest.start > previousFrom) return null
  return previous?.count ?? 0
}

export async function getProjectAnalytics(
  actor: ProjectActor,
  input: ProjectAnalyticsInput,
  now: Date = new Date(),
): Promise<ProjectAnalytics> {
  const data = parseInput(projectAnalyticsSchema, input)
  assertProjectAccess(actor, data.projectId, { flag: ['read'] })
  const { window, previousFrom, seriesFrom } = windowFor(data.range, now)
  const envIds = await environmentIds(data.projectId, data.environmentId)
  const b = flagEvaluationBuckets
  const inEnvironments = inArray(b.environmentId, envIds)
  const activeFlags = and(eq(flags.projectId, data.projectId), isNull(flags.archivedAt))

  const [series, previous, topFlags, [flagCount], [evaluatedCount]] = await Promise.all([
    db
      .select({ bucketStart: b.bucketStart, count: total })
      .from(b)
      .where(and(inEnvironments, gte(b.bucketStart, seriesFrom)))
      .groupBy(b.bucketStart)
      .orderBy(asc(b.bucketStart)),
    previousTotal(
      previousFrom,
      db
        .select({ count: total })
        .from(b)
        .where(
          and(inEnvironments, gte(b.bucketStart, previousFrom), lt(b.bucketStart, window.from)),
        ),
    ),
    db
      .select({ key: flags.key, name: flags.name, evaluations: total })
      .from(b)
      .innerJoin(flags, eq(flags.id, b.flagId))
      .where(and(inEnvironments, gte(b.bucketStart, window.from)))
      .groupBy(flags.id)
      .orderBy(desc(total), asc(flags.key))
      .limit(TOP_FLAGS_LIMIT),
    db.select({ count: count() }).from(flags).where(activeFlags),
    db
      .select({ count: countDistinct(b.flagId) })
      .from(b)
      .innerJoin(flags, eq(flags.id, b.flagId))
      .where(and(activeFlags, inEnvironments, gte(b.bucketStart, window.from))),
  ])

  const evaluations = series
    .filter((row) => row.bucketStart >= window.from)
    .reduce((sum, row) => sum + row.count, 0)
  return {
    window,
    totals: { evaluations, previous },
    flags: { total: flagCount?.count ?? 0, evaluated: evaluatedCount?.count ?? 0 },
    series,
    topFlags,
  }
}

export async function getFlagAnalytics(
  actor: ProjectActor,
  input: FlagAnalyticsInput,
  now: Date = new Date(),
): Promise<FlagAnalytics> {
  const data = parseInput(flagAnalyticsSchema, input)
  assertProjectAccess(actor, data.projectId, { flag: ['read'] })
  const { window, previousFrom, seriesFrom } = windowFor(data.range, now)
  const [flag] = await db
    .select({ id: flags.id })
    .from(flags)
    .where(and(eq(flags.projectId, data.projectId), eq(flags.key, data.flagKey)))
  if (!flag) throw notFound('Flag')
  const envIds = await environmentIds(data.projectId, data.environmentId)
  const b = flagEvaluationBuckets
  const scope = and(eq(b.flagId, flag.id), inArray(b.environmentId, envIds))

  const [rows, previous] = await Promise.all([
    db
      .select({ bucketStart: b.bucketStart, variant: b.variant, count: total })
      .from(b)
      .where(and(scope, gte(b.bucketStart, seriesFrom)))
      .groupBy(b.bucketStart, b.variant)
      .orderBy(asc(b.bucketStart), asc(b.variant)),
    previousTotal(
      previousFrom,
      db
        .select({ count: total })
        .from(b)
        .where(and(scope, gte(b.bucketStart, previousFrom), lt(b.bucketStart, window.from))),
    ),
  ])

  const series = rows.map((row) => ({ ...row, variant: row.variant === '' ? null : row.variant }))
  const byVariant = new Map<string | null, number>()
  for (const row of series) {
    if (row.bucketStart < window.from) continue
    byVariant.set(row.variant, (byVariant.get(row.variant) ?? 0) + row.count)
  }
  const variants = [...byVariant]
    .map(([variant, count]) => ({ variant, count }))
    // Most served first, errors last.
    .sort((x, y) => Number(x.variant === null) - Number(y.variant === null) || y.count - x.count)
  const evaluations = variants.reduce((sum, v) => sum + v.count, 0)
  return {
    window,
    totals: {
      evaluations,
      previous,
      errors: byVariant.get(null) ?? 0,
    },
    variants,
    series,
  }
}

/**
 * Deletes up to `batchSize` buckets older than {@link HISTORY_RETENTION_DAYS} and
 * returns how many were deleted.
 */
export async function pruneEvaluationHistory(
  now: Date = new Date(),
  batchSize = 10_000,
): Promise<number> {
  const cutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * 24 * HOUR_MS)
  const result = await db.execute(sql`
    delete from flag_evaluation_buckets
    where ctid in (
      select ctid from flag_evaluation_buckets
      where bucket_start < ${cutoff.toISOString()}::timestamptz
      limit ${batchSize}
    )
  `)
  return result.rowCount ?? 0
}
