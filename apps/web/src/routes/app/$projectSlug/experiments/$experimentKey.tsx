import {
  createFileRoute,
  getRouteApi,
  Link,
  notFound,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { AuditTimeline } from '@/components/audit'
import { EnvBadge } from '@/components/env/env-badge'
import {
  ConversionSnippetCard,
  type EnvironmentOption,
  ExperimentForm,
  type ExperimentFormValues,
  type ExperimentStatus,
  ExperimentStatusBadge,
  type FlagOption,
  ResultsCard,
  useExperimentActions,
} from '@/components/experiments'
import { FlagTypeBadge, IconButton, RolloutBar, VariantValue } from '@/components/flags'
import { PageHeader } from '@/components/layout/page-header'
import { HintedButton } from '@/components/settings/hinted-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime, formatPercent, formatRelativeTime } from '@/lib/format'
import { translate } from '@/lib/i18n'
import { listAuditLog } from '@/server/functions/audit-log'
import { getExperiment, updateExperiment } from '@/server/functions/experiments'

const projectRoute = getRouteApi('/app/$projectSlug')

/** Results refresh this often while the experiment runs. */
const REFRESH_MS = 30_000

export const Route = createFileRoute('/app/$projectSlug/experiments/$experimentKey')({
  validateSearch: z.object({
    tab: z.enum(['results', 'history']).optional().catch(undefined),
  }),
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData!.projectId
    const experiment = await getExperiment({
      data: { projectId, experimentKey: params.experimentKey },
    }).catch(() => null)
    if (!experiment) throw notFound()
    const history = await listAuditLog({
      data: { projectId, entityType: 'experiment', entityId: experiment.id, limit: 50 },
    }).catch(() => ({ items: [], nextCursor: null }))
    return { experiment, history, crumb: experiment.key }
  },
  head: ({ match, loaderData }) => {
    const t = translate(match.context.locale)
    return {
      meta: [
        {
          title: loaderData
            ? t('experiments:detail.pageTitle', { name: loaderData.experiment.name })
            : t('experiments:detail.pageTitleFallback'),
        },
      ],
    }
  },
  pendingComponent: () => (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="mt-4 h-10 w-48" />
      <Skeleton className="h-72 w-full" />
    </div>
  ),
  component: ExperimentDetailPage,
})

/** Re-renders every `intervalMs` so relative times stay current. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

function ExperimentDetailPage() {
  const { t, i18n } = useTranslation(['experiments', 'common'])
  const { experiment, history } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const canEdit = project.role !== 'viewer'
  const status: ExperimentStatus = experiment.status
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const environment = useMemo<EnvironmentOption>(
    () =>
      project.environments.find((e) => e.key === experiment.environment.key) ?? {
        key: experiment.environment.key,
        name: experiment.environment.name,
        color: 'var(--muted-foreground)',
        isProduction: false,
      },
    [project.environments, experiment.environment],
  )
  const environments = useMemo(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )
  const flag = useMemo<FlagOption>(
    () => ({
      key: experiment.flag.key,
      name: experiment.flag.name,
      type: experiment.flag.type,
      variants: experiment.flag.variants,
    }),
    [experiment.flag],
  )

  const { request, dialogs } = useExperimentActions({
    projectId: project.id,
    onDone: async (type) => {
      if (type === 'delete') {
        await navigate({
          to: '/app/$projectSlug/experiments',
          params: { projectSlug: project.slug },
        })
      }
    },
  })
  const target = { key: experiment.key, name: experiment.name, environment }

  // Refresh while running; skipped in background tabs.
  const [updatedAt, setUpdatedAt] = useState(() => new Date())
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new loader result means fresh data
  useEffect(() => setUpdatedAt(new Date()), [experiment])
  useEffect(() => {
    if (status !== 'running') return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void router.invalidate()
    }, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [status, router])
  const now = useNow(15_000)
  const refreshing = useRouterState({ select: (s) => s.isLoading })

  async function onSave(values: ExperimentFormValues) {
    setSaving(true)
    setSaveError(null)
    try {
      await updateExperiment({
        data: {
          projectId: project.id,
          experimentKey: experiment.key,
          patch: {
            name: values.name,
            hypothesis: values.hypothesis || null,
            allocation: values.allocation,
            conversionEvent: values.conversionEvent,
            controlVariant: values.controlVariant,
          },
        },
      })
      toast.success(t('detail.toastUpdated'))
      setEditing(false)
      await router.invalidate()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('detail.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  const freshness =
    status === 'running'
      ? t('common:labels.updatedAt', {
          time: formatRelativeTime(updatedAt, { now, locale: i18n.language }),
        })
      : status === 'stopped' && experiment.stoppedAt
        ? t('detail.frozen', { time: formatDateTime(experiment.stoppedAt, i18n.language) })
        : null

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/experiments" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> {t('common:labels.experiments')}
          </Link>
        </Button>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {experiment.name}
              <ExperimentStatusBadge status={status} />
            </span>
          }
          description={
            <span className="flex flex-col gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{experiment.key}</span>
                <span aria-hidden="true">·</span>
                <Link
                  to="/app/$projectSlug/flags/$flagKey"
                  params={{ projectSlug: project.slug, flagKey: experiment.flag.key }}
                  className="font-mono text-xs underline-offset-4 hover:text-foreground hover:underline"
                >
                  {experiment.flag.key}
                </Link>
                <FlagTypeBadge type={experiment.flag.type} />
                <EnvBadge env={environment} />
                {experiment.flag.archived ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t('detail.flagArchived')}
                  </Badge>
                ) : null}
              </span>
              {experiment.hypothesis ? (
                <span className="max-w-prose text-foreground">{experiment.hypothesis}</span>
              ) : null}
            </span>
          }
          actions={
            canEdit ? (
              <>
                <HintedButton
                  variant="outline"
                  onClick={() => {
                    setSaveError(null)
                    setEditing(true)
                  }}
                  disabledReason={
                    status === 'running'
                      ? t('detail.disabled.editRunning')
                      : status === 'stopped'
                        ? t('detail.disabled.editStopped')
                        : undefined
                  }
                >
                  <PencilIcon /> {t('common:actions.edit')}
                </HintedButton>
                {status === 'draft' ? (
                  <Button onClick={() => request('start', target)}>
                    <PlayIcon /> {t('common:actions.start')}
                  </Button>
                ) : null}
                {status === 'running' ? (
                  <Button variant="outline" onClick={() => request('stop', target)}>
                    <SquareIcon /> {t('common:actions.stop')}
                  </Button>
                ) : null}
                <HintedButton
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => request('delete', target)}
                  disabledReason={
                    status === 'running' ? t('detail.disabled.deleteRunning') : undefined
                  }
                >
                  <Trash2Icon /> {t('common:actions.delete')}
                </HintedButton>
              </>
            ) : null
          }
        />
      </div>

      <Tabs
        value={search.tab ?? 'results'}
        onValueChange={(tab) =>
          navigate({ search: { tab: tab as 'results' | 'history' }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="results">{t('results.title')}</TabsTrigger>
          <TabsTrigger value="history">{t('common:labels.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="mt-4 flex flex-col gap-6">
          {status === 'draft' ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('results.title')}</CardTitle>
                <CardDescription>{t('detail.draftDescription')}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ResultsCard
              results={experiment.results}
              flag={flag}
              actions={
                <span className="flex items-center gap-2 text-muted-foreground text-xs">
                  {freshness ? <span aria-live="polite">{freshness}</span> : null}
                  {status === 'running' ? (
                    <IconButton
                      label={t('detail.refreshResults')}
                      onClick={() => void router.invalidate()}
                      disabled={refreshing}
                    >
                      {refreshing ? <Spinner /> : <RefreshCwIcon />}
                    </IconButton>
                  ) : null}
                </span>
              }
            />
          )}

          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('detail.allocation.title')}</CardTitle>
                <CardDescription>{t('detail.allocation.description')}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <RolloutBar
                  variations={experiment.allocation}
                  variants={flag.variants}
                  type={flag.type}
                  showLabels
                  height={20}
                />
                <ul className="flex flex-col divide-y rounded-lg border">
                  {experiment.allocation.map((a) => {
                    const index = flag.variants.findIndex((v) => v.key === a.variant)
                    const variant = flag.variants[index]
                    return (
                      <li
                        key={a.variant}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <VariantValue
                            value={variant?.value ?? null}
                            type={flag.type}
                            variantKey={a.variant}
                            index={Math.max(index, 0)}
                            hideValue={!variant}
                          />
                          {a.variant === experiment.controlVariant ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t('badges.control')}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="tabular text-sm">{formatPercent(a.weight)}</span>
                      </li>
                    )
                  })}
                </ul>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t('labels.conversionEvent')}</dt>
                  <dd className="font-mono text-xs">{experiment.conversionEvent}</dd>
                  <dt className="text-muted-foreground">{t('labels.started')}</dt>
                  <dd>
                    {experiment.startedAt
                      ? formatDateTime(experiment.startedAt, i18n.language)
                      : t('detail.notStarted')}
                  </dd>
                  {experiment.stoppedAt ? (
                    <>
                      <dt className="text-muted-foreground">{t('labels.stopped')}</dt>
                      <dd>{formatDateTime(experiment.stoppedAt, i18n.language)}</dd>
                    </>
                  ) : null}
                </dl>
              </CardContent>
            </Card>

            <ConversionSnippetCard
              projectSlug={project.slug}
              environmentName={environment.name}
              conversionEvent={experiment.conversionEvent}
            />
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <AuditTimeline items={history.items} />
        </TabsContent>
      </Tabs>

      <Sheet open={editing} onOpenChange={(open) => !saving && setEditing(open)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('detail.edit.title')}</SheetTitle>
            <SheetDescription>{t('detail.edit.description')}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {editing ? (
              <ExperimentForm
                mode="edit"
                flags={[flag]}
                environments={environments}
                initial={{
                  flagKey: experiment.flag.key,
                  environmentKey: experiment.environment.key,
                  key: experiment.key,
                  name: experiment.name,
                  hypothesis: experiment.hypothesis ?? '',
                  allocation: experiment.allocation,
                  controlVariant: experiment.controlVariant,
                  conversionEvent: experiment.conversionEvent,
                }}
                pending={saving}
                error={saveError}
                submitLabel={t('detail.edit.submit')}
                onSubmit={onSave}
                actions={
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    {t('common:actions.cancel')}
                  </Button>
                }
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {dialogs}
    </div>
  )
}
