import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import type { AnalyticsRange } from '@/server/schemas/analytics'
import { useAnalyticsFormats } from './format'
import { changeRatio } from './timeline'

export interface StatTileProps {
  label: string
  value: ReactNode
  /** Full value on hover, when `value` is abbreviated. */
  title?: string
  detail?: ReactNode
}

/** One headline number of the KPI row. */
export function StatTile({ label, value, title, detail }: StatTileProps) {
  return (
    <Card className="gap-1">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span className="font-semibold text-3xl tracking-tight" title={title}>
          {value}
        </span>
        {detail ? <span className="text-muted-foreground text-xs">{detail}</span> : null}
      </CardContent>
    </Card>
  )
}

/**
 * "↗ +12 % vs. the previous 7 days". Neutral ink: more evaluations are neither good nor bad.
 */
export function ChangeText({
  current,
  previous,
  range,
}: {
  current: number
  /** Null when the history does not cover the previous period. */
  previous: number | null
  range: AnalyticsRange
}) {
  const { t } = useTranslation('analytics')
  const f = useAnalyticsFormats()
  const ratio = previous === null ? null : changeRatio(current, previous)
  const period = t(`periods.${range}`)
  if (ratio === null) return <span>{t('stats.noPrevious', { period })}</span>
  const Icon = ratio > 0 ? TrendingUpIcon : ratio < 0 ? TrendingDownIcon : MinusIcon
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {t('stats.change', { value: f.change(ratio), period })}
    </span>
  )
}
