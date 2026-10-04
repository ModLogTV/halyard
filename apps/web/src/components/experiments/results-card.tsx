import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { VariantValue, variantColor } from '@/components/flags'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  type ExperimentResults,
  MIN_CONVERSIONS_PER_VARIANT,
  MIN_EXPOSURES_PER_VARIANT,
  type VariantResult,
} from '@/server/experiments/stats'
import {
  type FlagOption,
  formatCount,
  formatLiftPoints,
  formatPValue,
  formatRateWithInterval,
  formatRelativeLift,
} from './utils'
import { VerdictBadge } from './verdict-badge'

const MotionRow = motion.create(TableRow)

const chartConfig = { rate: { label: 'Conversion rate' } } satisfies ChartConfig

function lookup(flag: FlagOption, variant: string) {
  const index = flag.variants.findIndex((v) => v.key === variant)
  return {
    index: Math.max(index, 0),
    found: index >= 0,
    value: flag.variants[index]?.value ?? null,
  }
}

/** One sentence per treatment variant; the headline for "not enough data" comes first. */
export function summarize(results: ExperimentResults): string[] {
  const treatments = results.variants.filter((v) => !v.isControl)
  if (treatments.length === 0) return []
  const control = results.variants.find((v) => v.isControl)
  const lowSample = treatments.every((v) => v.verdict === 'insufficient-data')
  if (lowSample) {
    const minExposures = Math.min(...results.variants.map((v) => v.exposures))
    if (minExposures < MIN_EXPOSURES_PER_VARIANT) {
      return [
        `Not enough data yet: ${formatCount(minExposures)} of ${MIN_EXPOSURES_PER_VARIANT} minimum exposures per variant.`,
      ]
    }
    const minConversions = Math.min(...results.variants.map((v) => v.conversions))
    return [
      `Not enough data yet: ${formatCount(minConversions)} of ${MIN_CONVERSIONS_PER_VARIANT} minimum conversions per variant.`,
    ]
  }
  return treatments.map((v) => {
    if (v.verdict === 'insufficient-data' || v.lift === null || v.pValue === null) {
      return `${v.variant}: not enough data yet (${formatCount(v.exposures)} exposures, ${formatCount(v.conversions)} conversions).`
    }
    const p = `p ${v.pValue < 0.001 ? '< 0.001' : `= ${formatPValue(v.pValue)}`}`
    if (v.verdict === 'no-difference') {
      return `${v.variant} shows no significant difference from ${control?.variant ?? 'control'} (${p}).`
    }
    const points = `${Math.abs(v.lift * 100).toFixed(1)} pp ${v.lift > 0 ? 'better' : 'worse'}`
    return `${v.variant} converts ${points} than ${control?.variant ?? 'control'}, ${p} — significant.`
  })
}

function liftClass(lift: number): string {
  if (lift > 0) return 'text-on'
  if (lift < 0) return 'text-destructive'
  return 'text-muted-foreground'
}

function LiftCell({ result }: { result: VariantResult }) {
  if (result.isControl) return <span className="text-muted-foreground">baseline</span>
  if (result.lift === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('tabular font-medium', liftClass(result.lift))}>
      {formatLiftPoints(result.lift)}
      {result.relativeLift !== null ? (
        <span className="ml-1 font-normal opacity-80">
          ({formatRelativeLift(result.relativeLift)})
        </span>
      ) : null}
    </span>
  )
}

function SampleProgress({ result, flag }: { result: VariantResult; flag: FlagOption }) {
  const { index, value, found } = lookup(flag, result.variant)
  const exposures = Math.min(100, (result.exposures / MIN_EXPOSURES_PER_VARIANT) * 100)
  const conversions = Math.min(100, (result.conversions / MIN_CONVERSIONS_PER_VARIANT) * 100)
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <VariantValue
        value={value}
        type={flag.type}
        variantKey={result.variant}
        index={index}
        hideValue={!found}
      />
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-muted-foreground text-xs">
          <span>Exposures</span>
          <span className="tabular">
            {formatCount(result.exposures)} / {MIN_EXPOSURES_PER_VARIANT}
          </span>
        </div>
        <Progress
          value={exposures}
          aria-label={`${result.variant} exposures toward the minimum sample`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-muted-foreground text-xs">
          <span>Conversions</span>
          <span className="tabular">
            {formatCount(result.conversions)} / {MIN_CONVERSIONS_PER_VARIANT}
          </span>
        </div>
        <Progress
          value={conversions}
          aria-label={`${result.variant} conversions toward the minimum sample`}
        />
      </div>
    </li>
  )
}

interface ChartDatum {
  variant: string
  rate: number
  low: number
  high: number
  exposures: number
  conversions: number
  fill: string
}

function ChartTip({ active, payload }: { active?: boolean; payload?: { payload: ChartDatum }[] }) {
  const d = active ? payload?.[0]?.payload : undefined
  if (!d) return null
  return (
    <div className="grid min-w-40 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-mono font-medium">{d.variant}</span>
      <span className="tabular">
        {d.rate.toFixed(1)}%{' '}
        <span className="text-muted-foreground">
          ({d.low.toFixed(1)}–{d.high.toFixed(1)}%, 95% interval)
        </span>
      </span>
      <span className="tabular text-muted-foreground">
        {formatCount(d.conversions)} of {formatCount(d.exposures)} converted
      </span>
    </div>
  )
}

interface IntervalShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: ChartDatum
}

/** A bar for the rate plus a whisker for the 95% interval, scaled from the bar's own width. */
function IntervalShape({ x = 0, y = 0, width = 0, height = 0, payload }: IntervalShapeProps) {
  if (!payload) return null
  const mid = y + height / 2
  const perPoint = payload.rate > 0 ? width / payload.rate : 0
  const lowX = x + payload.low * perPoint
  const highX = x + payload.high * perPoint
  const cap = Math.min(10, height / 2)
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={Math.max(width, 0)}
        height={height}
        rx={4}
        fill={payload.fill}
        fillOpacity={0.9}
      />
      {perPoint > 0 ? (
        <g stroke="var(--foreground)" strokeWidth={1.5} strokeLinecap="round" opacity={0.8}>
          <line x1={lowX} x2={highX} y1={mid} y2={mid} />
          <line x1={lowX} x2={lowX} y1={mid - cap / 2} y2={mid + cap / 2} />
          <line x1={highX} x2={highX} y1={mid - cap / 2} y2={mid + cap / 2} />
        </g>
      ) : null}
    </g>
  )
}

function RateChart({ results, flag }: { results: ExperimentResults; flag: FlagOption }) {
  const data: ChartDatum[] = results.variants.map((v) => {
    const rate = v.conversionRate * 100
    const low = (v.confidenceInterval?.lower ?? v.conversionRate) * 100
    const high = (v.confidenceInterval?.upper ?? v.conversionRate) * 100
    return {
      variant: v.variant,
      rate,
      low,
      high,
      exposures: v.exposures,
      conversions: v.conversions,
      fill: variantColor(lookup(flag, v.variant).index),
    }
  })
  const label = `Conversion rate per variant: ${data.map((d) => `${d.variant} ${d.rate.toFixed(1)}%`).join(', ')}`
  return (
    <div role="img" aria-label={label}>
      <ChartContainer
        config={chartConfig}
        className="aspect-auto w-full"
        style={{ height: 56 + data.length * 52 }}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 24, bottom: 4, left: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid horizontal={false} />
          <YAxis
            dataKey="variant"
            type="category"
            tickLine={false}
            axisLine={false}
            width={96}
            tick={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
          />
          <XAxis
            type="number"
            domain={[0, Math.max(5, Math.ceil(Math.max(...data.map((d) => d.high)) * 1.1))]}
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<ChartTip />} />
          <Bar
            dataKey="rate"
            isAnimationActive={false}
            shape={(props: unknown) => <IntervalShape {...(props as IntervalShapeProps)} />}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

export interface ResultsCardProps {
  results: ExperimentResults
  flag: FlagOption
  /** Shown top right, for example the refresh state. */
  actions?: ReactNode
}

export function ResultsCard({ results, flag, actions }: ResultsCardProps) {
  const reduceMotion = useReducedMotion()
  const sentences = summarize(results)
  const belowMinimum = results.variants.filter((v) => !v.minimumSampleReached)
  const noExposures = results.totalExposures === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Results</CardTitle>
        <CardDescription>
          Each variant is compared with the control using a two-proportion z-test. Conversions count
          once per subject.
        </CardDescription>
        {actions ? <CardAction>{actions}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">Exposures</TableHead>
                <TableHead className="text-right">Conversions</TableHead>
                <TableHead className="text-right">Conversion rate (95% interval)</TableHead>
                <TableHead className="text-right">Lift vs control</TableHead>
                <TableHead className="text-right">p-value</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence initial>
                {results.variants.map((v, i) => {
                  const { index, value, found } = lookup(flag, v.variant)
                  return (
                    <MotionRow
                      key={v.variant}
                      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: reduceMotion ? 0 : i * 0.05 }}
                    >
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <VariantValue
                            value={value}
                            type={flag.type}
                            variantKey={v.variant}
                            index={index}
                            hideValue={!found}
                          />
                          {v.isControl ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              control
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatCount(v.exposures)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatCount(v.conversions)}
                      </TableCell>
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {v.exposures === 0
                          ? '—'
                          : formatRateWithInterval(v.conversionRate, v.confidenceInterval)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <LiftCell result={v} />
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {v.pValue === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatPValue(v.pValue)
                        )}
                      </TableCell>
                      <TableCell>
                        <VerdictBadge verdict={v.verdict} />
                      </TableCell>
                    </MotionRow>
                  )
                })}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>

        {noExposures ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm">
            No exposures yet. They appear once contexts reaching the flag's default are evaluated
            while the experiment is running.
          </p>
        ) : (
          <RateChart results={results} flag={flag} />
        )}

        {sentences.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            {sentences.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        ) : null}

        {belowMinimum.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-sm">Progress toward the minimum sample</p>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {belowMinimum.map((v) => (
                <SampleProgress key={v.variant} result={v} flag={flag} />
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
