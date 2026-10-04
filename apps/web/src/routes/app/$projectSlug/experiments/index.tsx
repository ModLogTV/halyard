import {
  createFileRoute,
  type ErrorComponentProps,
  getRouteApi,
  Link,
  useNavigate,
} from '@tanstack/react-router'
import {
  FlaskConicalIcon,
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { EnvBadge } from '@/components/env/env-badge'
import {
  type EnvironmentOption,
  type ExperimentStatus,
  ExperimentStatusBadge,
  useExperimentActions,
} from '@/components/experiments'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { translate } from '@/lib/i18n'
import { listExperiments } from '@/server/functions/experiments'

const projectRoute = getRouteApi('/app/$projectSlug')

const FILTERS = ['all', 'running', 'draft', 'stopped'] as const
type Filter = (typeof FILTERS)[number]

export const Route = createFileRoute('/app/$projectSlug/experiments/')({
  validateSearch: z.object({
    status: z.enum(FILTERS).optional().catch(undefined),
  }),
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const experiments = await listExperiments({
      data: { projectId: parent.loaderData!.projectId },
    })
    return { experiments }
  },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('experiments:list.pageTitle') }],
  }),
  pendingComponent: ExperimentsPending,
  errorComponent: ExperimentsError,
  component: ExperimentsPage,
})

function ExperimentsError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation(['experiments', 'common'])
  return (
    <div className="p-6">
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>{t('list.loadFailedTitle')}</EmptyTitle>
          <EmptyDescription>
            {error instanceof Error ? error.message : t('common:errors.generic')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={reset}>
            {t('common:actions.tryAgain')}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

const SKELETON_ROWS = ['a', 'b', 'c', 'd']

function ExperimentsPending() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-9 w-36" />
      </div>
      <Skeleton className="h-9 w-80" />
      <div className="rounded-lg border">
        {SKELETON_ROWS.map((id) => (
          <div key={id} className="flex items-center gap-6 border-b px-4 py-4 last:border-0">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-4 w-24" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ExperimentsPage() {
  const { t, i18n } = useTranslation(['experiments', 'common'])
  const { experiments } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const canEdit = project.role !== 'viewer'
  const filter: Filter = search.status ?? 'all'

  const environments = useMemo(
    () => new Map<string, EnvironmentOption>(project.environments.map((e) => [e.key, e])),
    [project.environments],
  )
  const { request, dialogs } = useExperimentActions({ projectId: project.id })

  const counts = useMemo(() => {
    const out: Record<Filter, number> = {
      all: experiments.length,
      running: 0,
      draft: 0,
      stopped: 0,
    }
    for (const e of experiments) out[e.status] += 1
    return out
  }, [experiments])
  const filterLabel = (f: Filter) =>
    f === 'all'
      ? t('common:states.all')
      : f === 'running'
        ? t('common:states.running')
        : f === 'draft'
          ? t('common:states.draft')
          : t('status.stopped')
  const visible = filter === 'all' ? experiments : experiments.filter((e) => e.status === filter)

  const newButton = canEdit ? (
    <Button asChild>
      <Link to="/app/$projectSlug/experiments/new" params={{ projectSlug: project.slug }}>
        <PlusIcon /> {t('list.newButton')}
      </Link>
    </Button>
  ) : null

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader title={t('list.title')} description={t('list.description')} actions={newButton} />

      {experiments.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlaskConicalIcon />
            </EmptyMedia>
            <EmptyTitle>{t('list.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('list.empty.description')}</EmptyDescription>
          </EmptyHeader>
          {canEdit ? <EmptyContent>{newButton}</EmptyContent> : null}
        </Empty>
      ) : (
        <>
          <Tabs
            value={filter}
            onValueChange={(value) =>
              navigate({
                search: { status: value === 'all' ? undefined : (value as Filter) },
                replace: true,
              })
            }
          >
            <TabsList>
              {FILTERS.map((f) => (
                <TabsTrigger key={f} value={f}>
                  {filterLabel(f)}
                  <span className="tabular text-muted-foreground text-xs">{counts[f]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {visible.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyTitle>{t(`list.noFiltered.${filter}`)}</EmptyTitle>
                <EmptyDescription>{t('list.noFiltered.description')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => navigate({ search: {}, replace: true })}>
                  {t('list.showAll')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common:labels.experiment')}</TableHead>
                    <TableHead>{t('common:labels.flag')}</TableHead>
                    <TableHead>{t('common:labels.environment')}</TableHead>
                    <TableHead>{t('common:labels.status')}</TableHead>
                    <TableHead className="text-right">{t('labels.exposures')}</TableHead>
                    <TableHead className="text-right">{t('labels.conversions')}</TableHead>
                    <TableHead>{t('labels.started')}</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">{t('common:labels.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((experiment) => {
                    const env = environments.get(experiment.environmentKey)
                    const status: ExperimentStatus = experiment.status
                    const target = env && {
                      key: experiment.key,
                      name: experiment.name,
                      environment: env,
                    }
                    return (
                      <TableRow key={experiment.id}>
                        <TableCell>
                          <div className="flex min-w-0 flex-col">
                            <Link
                              to="/app/$projectSlug/experiments/$experimentKey"
                              params={{
                                projectSlug: project.slug,
                                experimentKey: experiment.key,
                              }}
                              className="w-fit font-medium underline-offset-4 hover:underline"
                            >
                              {experiment.name}
                            </Link>
                            <span className="font-mono text-muted-foreground text-xs">
                              {experiment.key}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Link
                            to="/app/$projectSlug/flags/$flagKey"
                            params={{ projectSlug: project.slug, flagKey: experiment.flagKey }}
                            className="font-mono text-xs underline-offset-4 hover:underline"
                          >
                            {experiment.flagKey}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {env ? (
                            <EnvBadge env={env} />
                          ) : (
                            <span className="font-mono text-xs">{experiment.environmentKey}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ExperimentStatusBadge status={status} />
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {experiment.counts.exposures.toLocaleString(i18n.language)}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {experiment.counts.conversions.toLocaleString(i18n.language)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                          {experiment.startedAt ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <time dateTime={new Date(experiment.startedAt).toISOString()}>
                                  {formatRelativeTime(experiment.startedAt, {
                                    locale: i18n.language,
                                  })}
                                </time>
                              </TooltipTrigger>
                              <TooltipContent>
                                {formatDateTime(experiment.startedAt, i18n.language)}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          {canEdit && target ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t('list.actionsAriaLabel', { key: experiment.key })}
                                >
                                  <MoreHorizontalIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {status === 'draft' ? (
                                  <DropdownMenuItem onClick={() => request('start', target)}>
                                    <PlayIcon /> {t('common:actions.start')}
                                  </DropdownMenuItem>
                                ) : null}
                                {status === 'running' ? (
                                  <DropdownMenuItem onClick={() => request('stop', target)}>
                                    <SquareIcon /> {t('common:actions.stop')}
                                  </DropdownMenuItem>
                                ) : null}
                                {status !== 'running' ? (
                                  <>
                                    {status === 'draft' ? <DropdownMenuSeparator /> : null}
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() => request('delete', target)}
                                    >
                                      <Trash2Icon /> {t('common:actions.delete')}
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
      {dialogs}
    </div>
  )
}
