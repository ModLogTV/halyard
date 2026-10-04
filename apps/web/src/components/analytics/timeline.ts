import type { AnalyticsRange } from '@/server/schemas/analytics'

const HOUR_MS = 3_600_000

/** Hourly points for 24 hours and 7 days, local calendar days for 30 days. */
export type Granularity = 'hour' | 'day'

const POINTS: Record<AnalyticsRange, { granularity: Granularity; count: number }> = {
  '24h': { granularity: 'hour', count: 24 },
  '7d': { granularity: 'hour', count: 7 * 24 },
  '30d': { granularity: 'day', count: 30 },
}

export function granularityFor(range: AnalyticsRange): Granularity {
  return POINTS[range].granularity
}

export interface TimelinePoint {
  /** Start of the bucket, epoch milliseconds. */
  start: number
  /** The newest bucket, still counting. */
  partial: boolean
  /** Evaluations per series key. */
  values: Record<string, number>
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Adds calendar days in local time, so days stay aligned across DST changes. */
function addLocalDays(ms: number, days: number): number {
  const date = new Date(ms)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

/**
 * Turns the sparse hourly rows of an analytics query into a gap-free timeline that ends
 * with the bucket containing `to` (the server time of the query). Every point carries
 * every key of `keys`, zero when nothing was evaluated. `seriesKey` picks the series of
 * a row; rows mapped to `null` or to keys outside `keys` are left out.
 */
export function buildTimeline<Row extends { bucketStart: Date | string; count: number }>(
  range: AnalyticsRange,
  rows: Row[],
  to: Date | string,
  keys: string[],
  seriesKey: (row: Row) => string | null,
): TimelinePoint[] {
  const { granularity, count } = POINTS[range]
  const end = new Date(to).getTime()
  const bucketOf =
    granularity === 'hour'
      ? (ms: number) => ms - (ms % HOUR_MS)
      : (ms: number) => startOfLocalDay(ms)
  const last = bucketOf(end)

  const points: TimelinePoint[] = []
  const byStart = new Map<number, TimelinePoint>()
  for (let i = count - 1; i >= 0; i--) {
    const start = granularity === 'hour' ? last - i * HOUR_MS : addLocalDays(last, -i)
    const point = {
      start,
      partial: start === last,
      values: Object.fromEntries(keys.map((key) => [key, 0])),
    }
    points.push(point)
    byStart.set(start, point)
  }

  const known = new Set(keys)
  for (const row of rows) {
    const key = seriesKey(row)
    if (key === null || !known.has(key)) continue
    const point = byStart.get(bucketOf(new Date(row.bucketStart).getTime()))
    if (point) point.values[key] = (point.values[key] ?? 0) + row.count
  }
  return points
}

/** Sum of all series of a point. */
export function pointTotal(point: TimelinePoint): number {
  return Object.values(point.values).reduce((sum, value) => sum + value, 0)
}

/** The point with the most evaluations, or null when nothing was evaluated. */
export function peakOf(points: TimelinePoint[]): { point: TimelinePoint; total: number } | null {
  let peak: { point: TimelinePoint; total: number } | null = null
  for (const point of points) {
    const total = pointTotal(point)
    if (total > 0 && (!peak || total > peak.total)) peak = { point, total }
  }
  return peak
}

/** Relative change against the previous period, or null without a previous value. */
export function changeRatio(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return (current - previous) / previous
}
