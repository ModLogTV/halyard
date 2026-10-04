import type { FlagType, Variant } from '@modlogtv/halyard-engine'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChartAreaIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnvironmentLike } from '@/components/env/env-badge'
import { variantColor } from '@/components/flags'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { getFlagAnalytics } from '@/server/functions/analytics'
import type { AnalyticsRange } from '@/server/schemas/analytics'
import { type ChartSeries, EvaluationsChart } from './evaluations-chart'
import { AnalyticsFilters } from './filters'
import { ChangeText } from './stat-tile'
import { buildTimeline } from './timeline'
import type { VariantShare } from './variant-share-chart'
import { VariantShareChart } from './variant-share-chart'

export interface FlagInsightsProps {
  projectId: string
  flag: { key: string; type: FlagType; variants: Variant[] }
  environments: (EnvironmentLike & { id: string })[]
  /** Selected environment key; all environments when undefined. */
  environmentKey: string | undefined
  range: AnalyticsRange
  onRangeChange: (range: AnalyticsRange) => void
  onEnvironmentChange: (key: string | undefined) => void
}

/** Usage of one flag: evaluations per variant over time and the share of each variant. */
export function FlagInsights({
  projectId,
  flag,
  environments,
  environmentKey,
  range,
  onRangeChange,
  onEnvironmentChange,
}: FlagInsightsProps) {
  const { t } = useTranslation('analytics')
  const environment = environments.find((env) => env.key === environmentKey)
  const query = useQuery({
    queryKey: ['flag-analytics', projectId, flag.key, environment?.id ?? null, range],
    queryFn: () =>
      getFlagAnalytics({
        data: { projectId, flagKey: flag.key, environmentId: environment?.id, range },
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const data = query.data

  // Colours follow the variant's position in the flag, like everywhere else in the UI;
  // variants that were removed since get the next free positions.
  const variantMeta = useMemo(() => {
    const meta = new Map<string, { index: number }>()
    flag.variants.forEach((variant, index) => {
      meta.set(variant.key, { index })
    })
    for (const row of data?.variants ?? []) {
      if (row.variant !== null && !meta.has(row.variant)) {
        meta.set(row.variant, { index: meta.size })
      }
    }
    return meta
  }, [flag.variants, data?.variants])

  const series = useMemo<ChartSeries[]>(
    () =>
      [...variantMeta]
        .filter(([key]) => data?.variants.some((row) => row.variant === key))
        .sort(([, a], [, b]) => a.index - b.index)
        .map(([key, meta]) => ({
          key: `v${meta.index}`,
          label: key,
          color: variantColor(meta.index),
        })),
    [variantMeta, data?.variants],
  )

  const points = useMemo(() => {
    if (!data) return []
    return buildTimeline(
      range,
      data.series,
      data.window.to,
      series.map((s) => s.key),
      (row) => {
        if (row.variant === null) return null
        const meta = variantMeta.get(row.variant)
        return meta ? `v${meta.index}` : null
      },
    )
  }, [data, range, series, variantMeta])

  const shares = useMemo<VariantShare[]>(
    () =>
      (data?.variants ?? []).map((row) => {
        if (row.variant === null) {
          return {
            key: 'errors',
            variant: null,
            index: -1,
            color: 'var(--destructive)',
            count: row.count,
          }
        }
        const meta = variantMeta.get(row.variant) ?? { index: 0 }
        return {
          key: `v${meta.index}`,
          variant: row.variant,
          index: meta.index,
          color: variantColor(meta.index),
          count: row.count,
        }
      }),
    [data?.variants, variantMeta],
  )

  const scope = environment?.name ?? t('filters.allEnvironments')

  return (
    <div className="flex flex-col gap-4">
      <AnalyticsFilters
        range={range}
        onRangeChange={onRangeChange}
        environments={environments}
        environmentKey={environment?.key}
        onEnvironmentChange={onEnvironmentChange}
      >
        {query.isFetching && data ? <Spinner className="text-muted-foreground" /> : null}
      </AnalyticsFilters>

      {query.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('errors.loadFailed')}</AlertDescription>
        </Alert>
      ) : !data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : data.totals.evaluations === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartAreaIcon />
            </EmptyMedia>
            <EmptyTitle>{t('empty.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.flagDescription', { scope })}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          className={cn(
            'flex flex-col gap-4 transition-opacity',
            query.isPlaceholderData && 'opacity-60',
          )}
        >
          <Card>
            <CardHeader>
              <CardTitle>{t('charts.flagEvaluations.title')}</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">
                  {t('stats.evaluationsCount', { count: data.totals.evaluations })}
                </span>
                <span aria-hidden="true">·</span>
                <ChangeText
                  current={data.totals.evaluations}
                  previous={data.totals.previous}
                  range={range}
                />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EvaluationsChart
                points={points}
                series={series}
                range={range}
                summary={t('charts.flagEvaluations.summary', {
                  scope,
                  period: t(`filters.ranges.${range}`),
                  total: data.totals.evaluations,
                })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('charts.variants.title')}</CardTitle>
              <CardDescription>
                {t('charts.variants.description', {
                  scope,
                  period: t(`filters.ranges.${range}`),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VariantShareChart shares={shares} type={flag.type} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
