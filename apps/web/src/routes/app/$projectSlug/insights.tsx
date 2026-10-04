import { createFileRoute, getRouteApi, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChartAreaIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import {
  AnalyticsFilters,
  buildTimeline,
  ChangeText,
  EvaluationsChart,
  granularityFor,
  peakOf,
  StatTile,
  TopFlagsChart,
  useAnalyticsFormats,
} from '@/components/analytics'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { translate } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { getProjectAnalytics } from '@/server/functions/analytics'
import { type AnalyticsRange, analyticsRangeSchema } from '@/server/schemas/analytics'

const projectRoute = getRouteApi('/app/$projectSlug')

const DEFAULT_RANGE: AnalyticsRange = '7d'

const searchSchema = z.object({
  range: analyticsRangeSchema.optional().catch(undefined),
  /** Environment key; all environments when omitted. */
  env: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/app/$projectSlug/insights')({
  staticData: { crumbKey: 'insights' },
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ range: search.range ?? DEFAULT_RANGE, env: search.env }),
  loader: async ({ deps, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const project = parent.loaderData?.project
    if (!project) return { analytics: null }
    const environmentId = project.environments.find((env) => env.key === deps.env)?.id
    const analytics = await getProjectAnalytics({
      data: { projectId: project.id, range: deps.range, environmentId },
    })
    return { analytics }
  },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('analytics:page.pageTitle') }],
  }),
  pendingComponent: InsightsPending,
  component: InsightsPage,
})

function InsightsPending() {
  const { t } = useTranslation('analytics')
  return (
    <div
      className="flex flex-col gap-6 p-6"
      role="status"
      aria-busy="true"
      aria-label={t('page.loading')}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-8 w-80" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  )
}

function InsightsPage() {
  const { t } = useTranslation('analytics')
  const f = useAnalyticsFormats()
  const { analytics } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const refreshing = useRouterState({ select: (s) => s.isLoading })
  const range = search.range ?? DEFAULT_RANGE

  const environments = useMemo(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )
  const environment = environments.find((env) => env.key === search.env)
  const scope = environment?.name ?? t('filters.allEnvironments')
  const period = t(`filters.ranges.${range}`)

  const series = useMemo(
    () => [{ key: 'evaluations', label: t('stats.evaluations'), color: 'var(--chart-1)' }],
    [t],
  )
  const points = useMemo(
    () =>
      analytics
        ? buildTimeline(
            range,
            analytics.series,
            analytics.window.to,
            ['evaluations'],
            () => 'evaluations',
          )
        : [],
    [analytics, range],
  )
  const peak = peakOf(points)

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={t('page.title')} description={t('page.description')} />

      <AnalyticsFilters
        range={range}
        onRangeChange={(next) => setSearch({ range: next === DEFAULT_RANGE ? undefined : next })}
        environments={environments}
        environmentKey={environment?.key}
        onEnvironmentChange={(env) => setSearch({ env })}
      >
        {refreshing ? <Spinner className="text-muted-foreground" /> : null}
      </AnalyticsFilters>

      {!analytics ? null : (
        <div className={cn('flex flex-col gap-6 transition-opacity', refreshing && 'opacity-60')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile
              label={t('stats.evaluations')}
              value={f.compact(analytics.totals.evaluations)}
              title={f.count(analytics.totals.evaluations)}
              detail={
                <ChangeText
                  current={analytics.totals.evaluations}
                  previous={analytics.totals.previous}
                  range={range}
                />
              }
            />
            <StatTile
              label={t('stats.activeFlags')}
              value={t('stats.activeFlagsValue', {
                evaluated: f.count(analytics.flags.evaluated),
                total: f.count(analytics.flags.total),
              })}
              detail={
                analytics.flags.total > analytics.flags.evaluated
                  ? t('stats.unusedFlags', {
                      count: analytics.flags.total - analytics.flags.evaluated,
                    })
                  : t('stats.allFlagsUsed')
              }
            />
            <StatTile
              label={granularityFor(range) === 'hour' ? t('stats.peakHour') : t('stats.peakDay')}
              value={peak ? f.compact(peak.total) : '—'}
              title={peak ? f.count(peak.total) : undefined}
              detail={peak ? f.bucket(granularityFor(range), peak.point.start) : t('stats.noPeak')}
            />
          </div>

          {analytics.totals.evaluations === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ChartAreaIcon />
                </EmptyMedia>
                <EmptyTitle>{t('empty.title')}</EmptyTitle>
                <EmptyDescription>{t('empty.projectDescription', { scope })}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('charts.evaluations.title')}</CardTitle>
                  <CardDescription>
                    {t('charts.evaluations.description', { scope, period })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <EvaluationsChart
                    points={points}
                    series={series}
                    range={range}
                    summary={t('charts.evaluations.summary', {
                      scope,
                      period,
                      total: analytics.totals.evaluations,
                    })}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('charts.topFlags.title')}</CardTitle>
                  <CardDescription>
                    {t('charts.topFlags.description', { scope, period })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TopFlagsChart flags={analytics.topFlags} projectSlug={project.slug} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  )
}
