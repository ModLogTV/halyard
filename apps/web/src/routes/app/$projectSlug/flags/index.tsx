import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { FlagIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { type FlagRow, FlagTable, type FlagTableEnvironment } from '@/components/flags/flag-table'
import { PageHeader } from '@/components/layout/page-header'
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
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { assessStaleness } from '@/lib/stale'
import { listFlags, toggleFlag } from '@/server/functions/flags'

const projectRoute = getRouteApi('/app/$projectSlug')

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  type: z.enum(['boolean', 'string', 'number', 'json']).optional().catch(undefined),
  tag: z.string().optional().catch(undefined),
  stale: z.boolean().optional().catch(undefined),
  archived: z.boolean().optional().catch(undefined),
})

export const Route = createFileRoute('/app/$projectSlug/flags/')({
  staticData: { crumbKey: 'flags' },
  validateSearch: searchSchema,
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const flags = await listFlags({
      data: { projectId: parent.loaderData!.project.id, includeArchived: true },
    })
    return { flags }
  },
  pendingComponent: FlagsPending,
  component: FlagsPage,
})

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e', 'f']
const TYPE_LABELS = {
  boolean: 'Boolean',
  string: 'String',
  number: 'Number',
  json: 'JSON',
} as const

function FlagsPending() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="rounded-lg border">
        {SKELETON_ROWS.map((id) => (
          <div key={id} className="flex items-center gap-6 border-b px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-4 w-24" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

function FlagsPage() {
  const { flags } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const canEdit = project.role !== 'viewer'

  const environments = useMemo(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )

  const rows = useMemo<FlagRow[]>(
    () =>
      flags.map((flag) => ({
        ...flag,
        staleness: assessStaleness(
          flag,
          flag.stats,
          environments.map((e) => e.id),
          {
            staleAfterDays: project.staleAfterDays,
            singleVariantAfterDays: project.singleVariantAfterDays,
          },
        ),
      })),
    [flags, environments, project.staleAfterDays, project.singleVariantAfterDays],
  )

  const allTags = useMemo(() => Array.from(new Set(flags.flatMap((f) => f.tags))).sort(), [flags])
  const staleCount = rows.filter((r) => r.staleness.stale && !r.archivedAt).length

  const filtered = useMemo(() => {
    const q = search.q?.trim().toLowerCase()
    return rows.filter((row) => {
      if (!search.archived && row.archivedAt) return false
      if (search.type && row.type !== search.type) return false
      if (search.tag && !row.tags.includes(search.tag)) return false
      if (search.stale && !row.staleness.stale) return false
      if (
        q &&
        !`${row.key} ${row.name} ${row.description ?? ''} ${row.tags.join(' ')}`
          .toLowerCase()
          .includes(q)
      )
        return false
      return true
    })
  }, [rows, search])

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const hasFilters = Boolean(
    search.q || search.type || search.tag || search.stale || search.archived,
  )

  async function onToggle(flag: FlagRow, environment: FlagTableEnvironment, enabled: boolean) {
    try {
      await toggleFlag({
        data: {
          projectId: project.id,
          flagKey: flag.key,
          environmentKey: environment.key,
          enabled,
        },
      })
      toast.success(`${flag.key} is now ${enabled ? 'on' : 'off'} in ${environment.name}`)
      await router.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the flag')
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Flags"
        description={`${flags.filter((f) => !f.archivedAt).length} active flags across ${environments.length} environments.`}
        actions={
          canEdit ? (
            <Button asChild>
              <Link to="/app/$projectSlug/flags/new" params={{ projectSlug: project.slug }}>
                <PlusIcon /> New flag
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search by key, name or tag"
            value={search.q ?? ''}
            onChange={(e) => setSearch({ q: e.target.value || undefined })}
            aria-label="Search flags"
          />
        </InputGroup>
        <Select
          value={search.type ?? 'all'}
          onValueChange={(v) =>
            setSearch({ type: v === 'all' ? undefined : (v as typeof search.type) })
          }
        >
          <SelectTrigger className="w-32" aria-label="Filter by type">
            <SelectValue>{search.type ? TYPE_LABELS[search.type] : 'All types'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="boolean">Boolean</SelectItem>
            <SelectItem value="string">String</SelectItem>
            <SelectItem value="number">Number</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
        {allTags.length > 0 ? (
          <Select
            value={search.tag ?? 'all'}
            onValueChange={(v) => setSearch({ tag: v === 'all' ? undefined : v })}
          >
            <SelectTrigger className="w-36" aria-label="Filter by tag">
              <SelectValue>{search.tag ?? 'All tags'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tags</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              variant="outline"
              size="sm"
              pressed={Boolean(search.stale)}
              onPressedChange={(v) => setSearch({ stale: v || undefined })}
              aria-label="Show cleanup candidates only"
              className="data-[state=on]:bg-warning-soft"
            >
              Cleanup candidates{' '}
              {staleCount > 0 ? (
                <span className="tabular text-muted-foreground">{staleCount}</span>
              ) : null}
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>
            Flags not evaluated for {project.staleAfterDays} days or returning one variant for{' '}
            {project.singleVariantAfterDays} days
          </TooltipContent>
        </Tooltip>
        <Toggle
          variant="outline"
          size="sm"
          pressed={Boolean(search.archived)}
          onPressedChange={(v) => setSearch({ archived: v || undefined })}
          aria-label="Include archived flags"
        >
          Archived
        </Toggle>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => navigate({ search: {}, replace: true })}>
            <XIcon /> Clear
          </Button>
        ) : null}
      </div>

      {flags.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlagIcon />
            </EmptyMedia>
            <EmptyTitle>No flags yet</EmptyTitle>
            <EmptyDescription>
              Create your first flag. It starts switched off in every environment, so nothing
              changes until you turn it on.
            </EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <EmptyContent>
              <Button asChild>
                <Link to="/app/$projectSlug/flags/new" params={{ projectSlug: project.slug }}>
                  <PlusIcon /> Create a flag
                </Link>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>No flags match these filters</EmptyTitle>
            <EmptyDescription>Try a different search or clear the filters.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => navigate({ search: {}, replace: true })}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <FlagTable
          flags={filtered}
          environments={environments}
          projectSlug={project.slug}
          canToggle={canEdit}
          onToggle={onToggle}
        />
      )}
    </div>
  )
}
