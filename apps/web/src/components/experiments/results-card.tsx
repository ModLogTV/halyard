import type { TFunction } from 'i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
import type { FlagOption } from './utils'
import { VerdictBadge } from './verdict-badge'

const MotionRow = motion.create(TableRow)

type ResultsT = TFunction<['experiments', 'common']>

/** Number formats for the viewer's language: counts, rates (0..1), lift in points, relative lift and p-values. */
function createFormats(locale: string) {
  const digits = { minimumFractionDigits: 1, maximumFractionDigits: 1 }
  const count = new Intl.NumberFormat(locale)
  const rate = new Intl.NumberFormat(locale, { style: 'percent', ...digits })
  const points = new Intl.NumberFormat(locale, { ...digits, signDisplay: 'exceptZero' })
  const relative = new Intl.NumberFormat(locale, {
    style: 'percent',
    ...digits,
    signDisplay: 'exceptZero',
  })
  const absolutePoints = new Intl.NumberFormat(locale, digits)
  const p = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  const tick = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  return {
    count: (value: number) => count.format(value),
    rate: (value: number) => rate.format(value),
    /** Lift in percentage points, signed, without the unit. */
    points: (value: number) => points.format(value * 100),
    absolutePoints: (value: number) => absolutePoints.format(Math.abs(value * 100)),
    relative: (value: number) => relative.format(value),
    pValue: (value: number) => (value < 0.001 ? `< ${p.format(0.001)}` : p.format(value)),
    pMinimum: () => p.format(0.001),
    tick: (value: number) => tick.format(value / 100),
  }
}
type Formats = ReturnType<typeof createFormats>

function useFormats(): Formats {
  const { i18n } = useTranslation()
  return useMemo(() => createFormats(i18n.language), [i18n.language])
}

function lookup(flag: FlagOption, variant: string) {
  const index = flag.variants.findIndex((v) => v.key === variant)
  return {
    index: Math.max(index, 0),
    found: index >= 0,
    value: flag.variants[index]?.value ?? null,
  }
}

/** One sentence per treatment variant; the headline for "not enough data" comes first. */
export function summarize(results: ExperimentResults, t: ResultsT, locale?: string): string[] {
  const f = createFormats(locale ?? 'en')
  const treatments = results.variants.filter((v) => !v.isControl)
  if (treatments.length === 0) return []
  const control = results.variants.find((v) => v.isControl)
  const controlName = control?.variant ?? t('badges.control')
  const lowSample = treatments.every((v) => v.verdict === 'insufficient-data')
  if (lowSample) {
    const minExposures = Math.min(...results.variants.map((v) => v.exposures))
    if (minExposures < MIN_EXPOSURES_PER_VARIANT) {
      return [
        t('results.summary.needMoreExposures', {
          current: f.count(minExposures),
          minimum: MIN_EXPOSURES_PER_VARIANT,
        }),
      ]
    }
    const minConversions = Math.min(...results.variants.map((v) => v.conversions))
    return [
      t('results.summary.needMoreConversions', {
        current: f.count(minConversions),
        minimum: MIN_CONVERSIONS_PER_VARIANT,
      }),
    ]
  }
  return treatments.map((v) => {
    if (v.verdict === 'insufficient-data' || v.lift === null || v.pValue === null) {
      return t('results.summary.variantNotEnough', {
        variant: v.variant,
        exposures: f.count(v.exposures),
        conversions: f.count(v.conversions),
      })
    }
    const p =
      v.pValue < 0.001
        ? t('results.summary.pLessThan', { value: f.pMinimum() })
        : t('results.summary.pEquals', { value: f.pValue(v.pValue) })
    if (v.verdict === 'no-difference') {
      return t('results.summary.noDifference', { variant: v.variant, control: controlName, p })
    }
    return t(v.lift > 0 ? 'results.summary.better' : 'results.summary.worse', {
      variant: v.variant,
      control: controlName,
      points: f.absolutePoints(v.lift),
      p,
    })
  })
}

function liftClass(lift: number): string {
  if (lift > 0) return 'text-on'
  if (lift < 0) return 'text-destructive'
  return 'text-muted-foreground'
}

function LiftCell({ result }: { result: VariantResult }) {
  const { t } = useTranslation(['experiments', 'common'])
  const f = useFormats()
  if (result.isControl) {
    return <span className="text-muted-foreground">{t('results.baseline')}</span>
  }
  if (result.lift === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('tabular font-medium', liftClass(result.lift))}>
      {t('results.points', { value: f.points(result.lift) })}
      {result.relativeLift !== null ? (
        <span className="ml-1 font-normal opacity-80">({f.relative(result.relativeLift)})</span>
      ) : null}
    </span>
  )
}

function SampleProgress({ result, flag }: { result: VariantResult; flag: FlagOption }) {
  const { t } = useTranslation(['experiments', 'common'])
  const f = useFormats()
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
          <span>{t('labels.exposures')}</span>
          <span className="tabular">
            {f.count(result.exposures)} / {MIN_EXPOSURES_PER_VARIANT}
          </span>
        </div>
        <Progress
          value={exposures}
          aria-label={t('results.progress.exposuresAria', { variant: result.variant })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-muted-foreground text-xs">
          <span>{t('labels.conversions')}</span>
          <span className="tabular">
            {f.count(result.conversions)} / {MIN_CONVERSIONS_PER_VARIANT}
          </span>
        </div>
        <Progress
          value={conversions}
          aria-label={t('results.progress.conversionsAria', { variant: result.variant })}
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
  const { t } = useTranslation(['experiments', 'common'])
  const f = useFormats()
  const d = active ? payload?.[0]?.payload : undefined
  if (!d) return null
  return (
    <div className="grid min-w-40 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-mono font-medium">{d.variant}</span>
      <span className="tabular">
        {f.rate(d.rate / 100)}{' '}
        <span className="text-muted-foreground">
          {t('results.chart.interval', {
            low: f.rate(d.low / 100),
            high: f.rate(d.high / 100),
          })}
        </span>
      </span>
      <span className="tabular text-muted-foreground">
        {t('results.chart.converted', {
          conversions: f.count(d.conversions),
          exposures: f.count(d.exposures),
        })}
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
  const { t, i18n } = useTranslation(['experiments', 'common'])
  const f = useFormats()
  const chartConfig = { rate: { label: t('results.chart.rateLabel') } } satisfies ChartConfig
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
  const label = t('results.chart.ariaLabel', {
    summary: new Intl.ListFormat(i18n.language, { style: 'short', type: 'unit' }).format(
      data.map((d) => `${d.variant} ${f.rate(d.rate / 100)}`),
    ),
  })
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
            tickFormatter={(v: number) => f.tick(v)}
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
  const { t, i18n } = useTranslation(['experiments', 'common'])
  const f = useFormats()
  const reduceMotion = useReducedMotion()
  const sentences = summarize(results, t, i18n.language)
  const belowMinimum = results.variants.filter((v) => !v.minimumSampleReached)
  const noExposures = results.totalExposures === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('results.title')}</CardTitle>
        <CardDescription>{t('results.description')}</CardDescription>
        {actions ? <CardAction>{actions}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:labels.variant')}</TableHead>
                <TableHead className="text-right">{t('labels.exposures')}</TableHead>
                <TableHead className="text-right">{t('labels.conversions')}</TableHead>
                <TableHead className="text-right">{t('results.columns.rate')}</TableHead>
                <TableHead className="text-right">{t('results.columns.lift')}</TableHead>
                <TableHead className="text-right">{t('results.columns.pValue')}</TableHead>
                <TableHead>{t('results.columns.verdict')}</TableHead>
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
                              {t('badges.control')}
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">{f.count(v.exposures)}</TableCell>
                      <TableCell className="tabular text-right">{f.count(v.conversions)}</TableCell>
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {v.exposures === 0
                          ? '—'
                          : v.confidenceInterval
                            ? `${f.rate(v.conversionRate)} (${f.rate(v.confidenceInterval.lower)}–${f.rate(v.confidenceInterval.upper)})`
                            : f.rate(v.conversionRate)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <LiftCell result={v} />
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {v.pValue === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          f.pValue(v.pValue)
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
            {t('results.noExposures')}
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
            <p className="font-medium text-sm">{t('results.progress.title')}</p>
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
