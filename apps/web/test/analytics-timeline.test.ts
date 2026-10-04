import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  changeRatio,
  granularityFor,
  peakOf,
  pointTotal,
} from '@/components/analytics/timeline'

const HOUR = 3_600_000
const TO = new Date('2030-06-10T12:30:00.000Z')
const CURRENT_HOUR = Date.parse('2030-06-10T12:00:00.000Z')
const hoursAgo = (hours: number) => new Date(CURRENT_HOUR - hours * HOUR)

describe('buildTimeline', () => {
  it('fills every hour of the last 24 hours and marks the current one as partial', () => {
    const points = buildTimeline(
      '24h',
      [
        { bucketStart: hoursAgo(0), variant: 'on', count: 5 },
        { bucketStart: hoursAgo(0), variant: 'off', count: 2 },
        { bucketStart: hoursAgo(3), variant: 'on', count: 4 },
        { bucketStart: hoursAgo(1), variant: null, count: 9 },
        { bucketStart: hoursAgo(30), variant: 'on', count: 100 },
      ],
      TO,
      ['on', 'off'],
      (row) => row.variant,
    )

    expect(points).toHaveLength(24)
    expect(points[0]!.start).toBe(hoursAgo(23).getTime())
    expect(points.at(-1)).toEqual({
      start: CURRENT_HOUR,
      partial: true,
      values: { on: 5, off: 2 },
    })
    expect(points.at(-4)).toEqual({
      start: hoursAgo(3).getTime(),
      partial: false,
      values: { on: 4, off: 0 },
    })
    expect(points.filter((p) => p.partial)).toHaveLength(1)
    expect(points.reduce((sum, p) => sum + pointTotal(p), 0)).toBe(11)
  })

  it('uses hourly points for 7 days', () => {
    const points = buildTimeline('7d', [], TO, ['evaluations'], () => 'evaluations')
    expect(points).toHaveLength(168)
    expect(points[0]!.start).toBe(hoursAgo(167).getTime())
    expect(granularityFor('7d')).toBe('hour')
  })

  it('groups 30 days into local calendar days ending today', () => {
    const rows = Array.from({ length: 31 * 24 }, (_, i) => ({
      bucketStart: hoursAgo(i),
      count: 1,
    }))
    const points = buildTimeline('30d', rows, TO, ['evaluations'], () => 'evaluations')

    const today = new Date(TO)
    today.setHours(0, 0, 0, 0)
    expect(points).toHaveLength(30)
    expect(points.at(-1)!.start).toBe(today.getTime())
    expect(points.at(-1)!.partial).toBe(true)
    // Every full local day collects 23 to 25 hours (DST), today only the hours so far.
    for (const point of points.slice(0, -1)) {
      expect(point.values.evaluations).toBeGreaterThanOrEqual(23)
      expect(point.values.evaluations).toBeLessThanOrEqual(25)
    }
    expect(granularityFor('30d')).toBe('day')
  })
})

describe('peakOf and changeRatio', () => {
  it('finds the busiest point and ignores empty timelines', () => {
    const points = buildTimeline(
      '24h',
      [
        { bucketStart: hoursAgo(2), count: 7 },
        { bucketStart: hoursAgo(5), count: 3 },
      ],
      TO,
      ['evaluations'],
      () => 'evaluations',
    )
    expect(peakOf(points)).toMatchObject({ total: 7, point: { start: hoursAgo(2).getTime() } })
    expect(peakOf(buildTimeline('24h', [], TO, ['x'], () => 'x'))).toBeNull()
  })

  it('compares with the previous period', () => {
    expect(changeRatio(150, 100)).toBe(0.5)
    expect(changeRatio(50, 100)).toBe(-0.5)
    expect(changeRatio(10, 0)).toBeNull()
  })
})
