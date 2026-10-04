import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalyticsRange } from '@/server/schemas/analytics'
import { type Granularity, granularityFor } from './timeline'

/** Number and date formats for the analytics views, in the UI language. */
export function createAnalyticsFormats(locale: string) {
  const count = new Intl.NumberFormat(locale)
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const change = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  })
  const hour = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const hourLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return {
    count: (value: number) => count.format(value),
    compact: (value: number) => compact.format(value),
    percent: (value: number) => percent.format(value),
    change: (value: number) => change.format(value),
    /** Axis tick for a bucket start: hours for 24 hours, weekdays for 7 days, dates for 30 days. */
    tick: (range: AnalyticsRange, start: number) => {
      if (range === '24h') return hour.format(start)
      if (range === '7d') return weekday.format(start)
      return day.format(start)
    },
    /** Tooltip heading for a bucket start. */
    bucket: (granularity: Granularity, start: number) =>
      granularity === 'hour' ? hourLabel.format(start) : dayLabel.format(start),
  }
}

export type AnalyticsFormats = ReturnType<typeof createAnalyticsFormats>

export function useAnalyticsFormats(): AnalyticsFormats {
  const { i18n } = useTranslation()
  return useMemo(() => createAnalyticsFormats(i18n.language), [i18n.language])
}

export { granularityFor }
