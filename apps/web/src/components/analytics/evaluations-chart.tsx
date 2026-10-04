import { useReducedMotion } from 'motion/react'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { useMounted } from '@/components/schedules/use-now'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import type { AnalyticsRange } from '@/server/schemas/analytics'
import { useAnalyticsFormats } from './format'
import { granularityFor, type TimelinePoint } from './timeline'

export interface ChartSeries {
  /** Data key; also used in `--color-<key>`, so letters and digits only. */
  key: string
  label: string
  color: string
}

export interface EvaluationsChartProps {
  points: TimelinePoint[]
  series: ChartSeries[]
  range: AnalyticsRange
  /** Screen reader summary of what the chart shows. */
  summary: string
  className?: string
}

type Datum = { start: number; partial: boolean } & Record<string, number | boolean>

/**
 * Evaluations over time as an area chart: one series as a soft gradient, several series
 * stacked (variants) with a legend. A crosshair tooltip lists every series of a bucket.
 */
export function EvaluationsChart({
  points,
  series,
  range,
  summary,
  className,
}: EvaluationsChartProps) {
  const { t } = useTranslation('analytics')
  const f = useAnalyticsFormats()
  const mounted = useMounted()
  const reduceMotion = useReducedMotion()
  const gradientId = useId().replace(/:/g, '')
  const stacked = series.length > 1
  const granularity = granularityFor(range)

  const config = useMemo(
    () =>
      Object.fromEntries(
        series.map((s) => [s.key, { label: s.label, color: s.color }]),
      ) satisfies ChartConfig,
    [series],
  )
  const data = useMemo<Datum[]>(
    () => points.map((p) => ({ start: p.start, partial: p.partial, ...p.values })),
    [points],
  )
  // 7 days of hourly points: one tick per local midnight.
  const ticks = useMemo(
    () =>
      range === '7d'
        ? data.filter((d) => new Date(d.start).getHours() === 0).map((d) => d.start)
        : undefined,
    [data, range],
  )

  const height = stacked ? 'h-72' : 'h-64'
  // Charts depend on the viewer's time zone, so they render after hydration only.
  if (!mounted) return <div className={cn(height, 'w-full', className)} aria-hidden="true" />

  return (
    <figure className={cn('m-0', className)}>
      <figcaption className="sr-only">{summary}</figcaption>
      <ChartContainer config={config} className={cn('aspect-auto w-full', height)}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
          {stacked ? null : (
            <defs>
              {series.map((s) => (
                <linearGradient
                  key={s.key}
                  id={`${gradientId}-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={`var(--color-${s.key})`} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={`var(--color-${s.key})`} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
          )}
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="start"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={28}
            ticks={ticks}
            interval={ticks ? 0 : 'preserveStartEnd'}
            tickFormatter={(value: number) => f.tick(range, value)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={false}
            tickFormatter={(value: number) => f.compact(value)}
          />
          <ChartTooltip
            cursor={{ strokeWidth: 1 }}
            content={
              <ChartTooltipContent
                indicator="line"
                valueFormatter={f.count}
                labelFormatter={(_, payload) => {
                  const datum = payload?.[0]?.payload as Datum | undefined
                  if (!datum) return null
                  const label = f.bucket(granularity, datum.start)
                  return datum.partial ? `${label} · ${t('charts.inProgress')}` : label
                }}
              />
            }
          />
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stackId={stacked ? 'evaluations' : undefined}
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              fill={stacked ? `var(--color-${s.key})` : `url(#${gradientId}-${s.key})`}
              fillOpacity={stacked ? 0.16 : 1}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
              isAnimationActive={!reduceMotion}
            />
          ))}
          {stacked ? <ChartLegend content={<ChartLegendContent />} /> : null}
        </AreaChart>
      </ChartContainer>
    </figure>
  )
}
