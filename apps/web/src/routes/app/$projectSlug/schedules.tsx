import { createFileRoute, getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { CalendarClockIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { EnvDot } from '@/components/env/env-badge'
import { PageHeader } from '@/components/layout/page-header'
import { ScheduleChangeDialog, ScheduleTimeline, useMounted, useNow } from '@/components/schedules'
import type { TimelineFlagInfo } from '@/components/schedules/schedule-timeline'
import { HintedButton } from '@/components/settings/hinted-button'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { listFlags } from '@/server/functions/flags'
import { listScheduledChanges } from '@/server/functions/scheduled-changes'

const projectRoute = getRouteApi('/app/$projectSlug')

const STATUS_FILTERS = ['upcoming', 'past', 'all'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]
const STATUS_LABELS: Record<StatusFilter, string> = {
  upcoming: 'Upcoming',
  past: 'Past',
  all: 'All',
}

export const Route = createFileRoute('/app/$projectSlug/schedules')({
  staticData: { crumbKey: 'schedules' },
  validateSearch: z.object({
    status: z.enum(STATUS_FILTERS).optional().catch(undefined),
    env: z.string().optional().catch(undefined),
    flag: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ env: search.env }),
  loader: async ({ parentMatchPromise, deps }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData!.project.id
    const [items, flags] = await Promise.all([
      listScheduledChanges({
        data: { projectId, environmentKey: deps.env, includePast: true },
      }),
      listFlags({ data: { projectId, includeArchived: true } }).catch(() => []),
    ])
    return { items, flags }
  },
  head: () => ({ meta: [{ title: 'Scheduled changes · Halyard' }] }),
  pendingComponent: SchedulesPending,
  errorComponent: ({ error, reset }) => (
    <div className="p-6">
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>Could not load scheduled changes</EmptyTitle>
          <EmptyDescription>
            {error instanceof Error ? error.message : 'Something went wrong.'}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  ),
  component: SchedulesPage,
})

const SKELETON_ROWS = ['a', 'b', 'c']

function SchedulesPending() {
  return (
    <div className="flex flex-col gap-4 p-6" role="status" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-40" />
      </div>
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-4 w-32" />
      {SKELETON_ROWS.map((id) => (
        <Skeleton key={id} className="h-24 w-full" />
      ))}
    </div>
  )
}

const isPast = (status: string) => status !== 'pending' && status !== 'running'

function SchedulesPage() {
  const { items, flags } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const mounted = useMounted()
  const now = useNow()
  const [dialogOpen, setDialogOpen] = useState(false)
  const canEdit = project.role !== 'viewer'
  const status: StatusFilter = search.status ?? 'upcoming'
  const flagQuery = (search.flag ?? '').trim().toLowerCase()

  const environments = useMemo(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )
  const environmentMap = useMemo(() => new Map(environments.map((e) => [e.key, e])), [environments])
  const flagMap = useMemo(
    () =>
      new Map<string, TimelineFlagInfo>(
        flags.map((f) => [f.key, { type: f.type, variants: f.variants }]),
      ),
    [flags],
  )

  const visible = useMemo(() => {
    const filtered = items.filter((item) => {
      if (status === 'upcoming' && isPast(item.status)) return false
      if (status === 'past' && !isPast(item.status)) return false
      if (flagQuery) {
        return (
          item.flagKey.toLowerCase().includes(flagQuery) ||
          item.flagName.toLowerCase().includes(flagQuery)
        )
      }
      return true
    })
    // The server sorts ascending; history reads better newest first.
    return status === 'upcoming' ? filtered : [...filtered].reverse()
  }, [items, status, flagQuery])

  // Refresh shortly after the next pending change is due so its status catches up.
  const nextDue = useMemo(() => {
    const times = items
      .filter((item) => item.status === 'pending' || item.status === 'running')
      .map((item) => new Date(item.scheduledFor).getTime())
      .filter((time) => time > Date.now() - 60_000)
    return times.length > 0 ? Math.min(...times) : null
  }, [items])
  useEffect(() => {
    if (nextDue === null) return
    const delay = Math.min(Math.max(nextDue - Date.now() + 4_000, 4_000), 2 ** 31 - 1)
    const timer = window.setTimeout(() => void router.invalidate(), delay)
    return () => window.clearTimeout(timer)
  }, [nextDue, router])

  const setSearch = (patch: Partial<{ status: StatusFilter; env: string; flag: string }>) =>
    navigate({
      search: (prev) => {
        const next = { ...prev, ...patch }
        return {
          status: next.status === 'upcoming' ? undefined : next.status,
          env: next.env || undefined,
          flag: next.flag || undefined,
        }
      },
      replace: true,
    })

  const scheduleButton = (
    <HintedButton
      onClick={() => setDialogOpen(true)}
      disabledReason={canEdit ? undefined : 'Viewers cannot schedule changes'}
    >
      <PlusIcon /> Schedule a change
    </HintedButton>
  )

  const filtering = Boolean(search.env) || Boolean(flagQuery)
  const nothingAtAll = items.length === 0 && !filtering

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Scheduled changes"
        description="Changes that run automatically at a point in time. They run exactly once, even with several replicas."
        actions={scheduleButton}
      />

      {nothingAtAll ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClockIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing scheduled</EmptyTitle>
            <EmptyDescription>
              Schedule a flag to turn on or off, or to change its default, at a time you choose. A
              staged rollout ramps a variant up in steps, for example 10 % tomorrow morning, then 25
              %, 50 % and 100 % over the next days.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{scheduleButton}</EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={status}
              onValueChange={(value) => setSearch({ status: value as StatusFilter })}
            >
              <TabsList>
                {STATUS_FILTERS.map((f) => (
                  <TabsTrigger key={f} value={f}>
                    {STATUS_LABELS[f]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Select
              value={search.env ?? 'all'}
              onValueChange={(value) => setSearch({ env: value === 'all' ? '' : value })}
            >
              <SelectTrigger className="w-48" aria-label="Environment">
                <SelectValue placeholder="All environments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All environments</SelectItem>
                {environments.map((env) => (
                  <SelectItem key={env.key} value={env.key}>
                    <EnvDot env={env} />
                    {env.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <InputGroup className="w-full sm:w-64">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                value={search.flag ?? ''}
                onChange={(event) => setSearch({ flag: event.target.value })}
                placeholder="Search flags"
                aria-label="Search flags"
              />
            </InputGroup>
          </div>

          {!mounted ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              {SKELETON_ROWS.map((id) => (
                <Skeleton key={id} className="h-24 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClockIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {filtering
                    ? 'No matching scheduled changes'
                    : status === 'upcoming'
                      ? 'Nothing upcoming'
                      : 'No past changes yet'}
                </EmptyTitle>
                <EmptyDescription>
                  {filtering
                    ? 'Try another environment or search term.'
                    : status === 'upcoming'
                      ? 'Everything scheduled has run. Schedule the next change or check the past ones.'
                      : 'Completed, failed and cancelled changes show up here.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {filtering ? (
                  <Button
                    variant="outline"
                    onClick={() => navigate({ search: { status: search.status }, replace: true })}
                  >
                    Clear filters
                  </Button>
                ) : status === 'upcoming' ? (
                  scheduleButton
                ) : null}
              </EmptyContent>
            </Empty>
          ) : (
            <ScheduleTimeline
              projectId={project.id}
              projectSlug={project.slug}
              items={visible}
              all={items}
              environments={environmentMap}
              flags={flagMap}
              canEdit={canEdit}
              now={now}
            />
          )}
        </>
      )}

      <ScheduleChangeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        environmentKey={search.env}
      />
    </div>
  )
}
