import type { FlagType } from '@modlogtv/halyard-engine'
import { TriangleAlertIcon } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Label, Pie, PieChart } from 'recharts'
import { VariantValue } from '@/components/flags'
import { useMounted } from '@/components/schedules/use-now'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAnalyticsFormats } from './format'

export interface VariantShare {
  /** Chart key (`v0`, `v1`, … or `errors`). */
  key: string
  /** Variant key, or null for evaluations that returned an error. */
  variant: string | null
  /** Position in the flag's variants, which picks the colour. */
  index: number
  color: string
  count: number
}

/** Part-to-whole of the served variants: a donut with the total, and the exact numbers beside it. */
export function VariantShareChart({ shares, type }: { shares: VariantShare[]; type: FlagType }) {
  const { t } = useTranslation('analytics')
  const f = useAnalyticsFormats()
  const mounted = useMounted()
  const reduceMotion = useReducedMotion()
  const total = shares.reduce((sum, share) => sum + share.count, 0)

  const config = useMemo(
    () =>
      Object.fromEntries(
        shares.map((share) => [
          share.key,
          { label: share.variant ?? t('charts.variants.errors'), color: share.color },
        ]),
      ) satisfies ChartConfig,
    [shares, t],
  )
  const data = shares.map((share) => ({
    key: share.key,
    count: share.count,
    fill: `var(--color-${share.key})`,
  }))

  return (
    <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
      {mounted ? (
        <ChartContainer config={config} className="aspect-square h-44 shrink-0">
          <PieChart accessibilityLayer>
            <ChartTooltip
              content={<ChartTooltipContent hideLabel nameKey="key" valueFormatter={f.count} />}
            />
            <Pie
              data={data}
              dataKey="count"
              nameKey="key"
              innerRadius={58}
              outerRadius={82}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={!reduceMotion}
            >
              <Label
                content={({ viewBox }) => {
                  if (!viewBox || !('cx' in viewBox)) return null
                  const { cx = 0, cy = 0 } = viewBox
                  return (
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan x={cx} y={cy - 6} className="fill-foreground font-semibold text-xl">
                        {f.compact(total)}
                      </tspan>
                      <tspan x={cx} y={cy + 14} className="fill-muted-foreground text-xs">
                        {t('stats.evaluations')}
                      </tspan>
                    </text>
                  )
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      ) : (
        <div className="size-44 shrink-0" aria-hidden="true" />
      )}
      <Table className="min-w-0 flex-1">
        <TableHeader>
          <TableRow>
            <TableHead>{t('charts.variants.variant')}</TableHead>
            <TableHead className="text-right">{t('stats.evaluations')}</TableHead>
            <TableHead className="text-right">{t('charts.variants.share')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shares.map((share) => (
            <TableRow key={share.key}>
              <TableCell className="max-w-0 w-full">
                {share.variant === null ? (
                  <span className="flex items-center gap-2">
                    <TriangleAlertIcon className="size-3.5 text-destructive" aria-hidden="true" />
                    {t('charts.variants.errors')}
                  </span>
                ) : (
                  <VariantValue
                    variantKey={share.variant}
                    value={null}
                    type={type}
                    index={share.index}
                    hideValue
                  />
                )}
              </TableCell>
              <TableCell className="tabular text-right">{f.count(share.count)}</TableCell>
              <TableCell className="tabular text-right">
                {f.percent(total > 0 ? share.count / total : 0)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
