import { useNavigate } from '@tanstack/react-router'
import { useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, LabelList, XAxis, YAxis, type YAxisTickContentProps } from 'recharts'
import { useMounted } from '@/components/schedules/use-now'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { useAnalyticsFormats } from './format'

export interface TopFlag {
  key: string
  name: string
  evaluations: number
}

const ROW_HEIGHT = 36
const MAX_LABEL_CHARS = 28
/** Approximate width of one character of the 12px monospace tick font. */
const CHAR_WIDTH = 7.3

function shorten(key: string): string {
  return key.length > MAX_LABEL_CHARS ? `${key.slice(0, MAX_LABEL_CHARS - 1)}…` : key
}

/**
 * Horizontal bars of the most evaluated flags, value at the bar end. Flag keys are links,
 * so the chart also works from the keyboard.
 */
export function TopFlagsChart({ flags, projectSlug }: { flags: TopFlag[]; projectSlug: string }) {
  const { t } = useTranslation('analytics')
  const f = useAnalyticsFormats()
  const mounted = useMounted()
  const reduceMotion = useReducedMotion()
  const navigate = useNavigate()
  const config = {
    evaluations: { label: t('stats.evaluations'), color: 'var(--chart-1)' },
  } satisfies ChartConfig

  const height = flags.length * ROW_HEIGHT + 8
  const longest = Math.max(...flags.map((flag) => shorten(flag.key).length), 6)
  const labelWidth = Math.ceil(longest * CHAR_WIDTH) + 12

  const open = (flagKey: string) =>
    navigate({ to: '/app/$projectSlug/flags/$flagKey', params: { projectSlug, flagKey } })

  const renderTick = ({ x, y, payload }: YAxisTickContentProps) => {
    const key = String(payload.value)
    return (
      <a
        href={`/app/${projectSlug}/flags/${encodeURIComponent(key)}`}
        aria-label={key}
        onClick={(event) => {
          event.preventDefault()
          void open(key)
        }}
        className="outline-none [&:focus-visible>text]:underline"
      >
        <title>{key}</title>
        <text
          x={x}
          y={y}
          dy={4}
          textAnchor="end"
          className="fill-foreground font-mono text-xs hover:underline"
        >
          {shorten(key)}
        </text>
      </a>
    )
  }

  if (!mounted) return <div style={{ height }} aria-hidden="true" />

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart
        data={flags}
        layout="vertical"
        margin={{ top: 0, right: 56, bottom: 0, left: 0 }}
        accessibilityLayer
      >
        <XAxis type="number" dataKey="evaluations" hide domain={[0, 'dataMax']} />
        <YAxis
          type="category"
          dataKey="key"
          tickLine={false}
          axisLine={false}
          width={labelWidth}
          tick={renderTick}
        />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          content={
            <ChartTooltipContent
              indicator="line"
              valueFormatter={f.count}
              labelFormatter={(_, payload) => {
                const flag = payload?.[0]?.payload as TopFlag | undefined
                return flag ? flag.name : null
              }}
            />
          }
        />
        <Bar
          dataKey="evaluations"
          fill="var(--color-evaluations)"
          radius={[0, 4, 4, 0]}
          barSize={18}
          className="cursor-pointer"
          isAnimationActive={!reduceMotion}
          onClick={(entry: { payload?: TopFlag }) => {
            if (entry.payload) void open(entry.payload.key)
          }}
        >
          <LabelList
            dataKey="evaluations"
            position="right"
            offset={8}
            className="fill-foreground tabular"
            fontSize={12}
            formatter={(value: unknown) => (typeof value === 'number' ? f.compact(value) : '')}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
