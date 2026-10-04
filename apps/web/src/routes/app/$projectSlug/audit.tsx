import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { FilterXIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { AuditTimeline } from '@/components/audit'
import { EnvDot } from '@/components/env/env-badge'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { listAuditLog } from '@/server/functions/audit-log'

const projectRoute = getRouteApi('/app/$projectSlug')

const ENTITY_TYPES = [
  'flag',
  'segment',
  'environment',
  'experiment',
  'schedule',
  'webhook',
  'api_key',
  'member',
  'project',
] as const

const ENTITY_LABELS: Record<(typeof ENTITY_TYPES)[number], string> = {
  flag: 'Flags',
  segment: 'Segments',
  environment: 'Environments',
  experiment: 'Experiments',
  schedule: 'Schedules',
  webhook: 'Webhooks',
  api_key: 'API keys',
  member: 'Members',
  project: 'Project',
}

const searchSchema = z.object({
  /** Environment key. */
  env: z.string().optional().catch(undefined),
  type: z.enum(ENTITY_TYPES).optional().catch(undefined),
  /** Exact action or a prefix pattern such as `flag.*`. */
  action: z.string().optional().catch(undefined),
  /** `datetime-local` values (`2026-03-04T14:30`). */
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
})
type AuditSearch = z.infer<typeof searchSchema>

const PAGE_SIZE = 50
const ALL = '__all__'

const toIso = (local: string | undefined): string | undefined => {
  if (!local) return undefined
  const date = new Date(local)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function toQuery(
  project: { id: string; environments: { id: string; key: string }[] },
  search: AuditSearch,
) {
  return {
    projectId: project.id,
    environmentId: project.environments.find((env) => env.key === search.env)?.id,
    entityType: search.type,
    action: search.action?.trim() || undefined,
    from: toIso(search.from),
    to: toIso(search.to),
    limit: PAGE_SIZE,
  }
}

export const Route = createFileRoute('/app/$projectSlug/audit')({
  staticData: { crumbKey: 'auditLog' },
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    env: search.env,
    type: search.type,
    action: search.action,
    from: search.from,
    to: search.to,
  }),
  loader: async ({ deps, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const project = parent.loaderData?.project
    if (!project) return { page: { items: [], nextCursor: null } }
    return { page: await listAuditLog({ data: toQuery(project, deps) }) }
  },
  head: () => ({ meta: [{ title: 'Audit log · Halyard' }] }),
  pendingComponent: AuditPending,
  component: AuditPage,
})

function AuditPending() {
  return (
    <div
      className="flex flex-col gap-6 p-6"
      role="status"
      aria-busy="true"
      aria-label="Loading audit log"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-16 w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}

function AuditPage() {
  const search = Route.useSearch()
  const { page } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const navigate = Route.useNavigate()

  const setSearch = (patch: Partial<AuditSearch>) =>
    navigate({
      search: (prev) => {
        const next = { ...prev, ...patch }
        return Object.fromEntries(
          Object.entries(next).filter(([, value]) => value !== undefined && value !== ''),
        ) as AuditSearch
      },
      replace: true,
    })

  const [actionText, setActionText] = useState(search.action ?? '')
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Keep the field in sync when the filter is cleared or changed from outside (back button).
  useEffect(() => setActionText(search.action ?? ''), [search.action])
  useEffect(() => () => clearTimeout(debounce.current), [])
  const onActionChange = (value: string) => {
    setActionText(value)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setSearch({ action: value.trim() || undefined }), 400)
  }

  const filtered = Boolean(search.env || search.type || search.action || search.from || search.to)
  const rangeInvalid = Boolean(search.from && search.to && search.from > search.to)

  const clearFilters = () => {
    clearTimeout(debounce.current)
    setActionText('')
    navigate({ search: {}, replace: true })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Audit log"
        description="Every change to flags, segments, environments and members in this project."
      />

      <form
        className="rounded-lg border p-4"
        onSubmit={(event) => event.preventDefault()}
        aria-label="Filter audit log"
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field>
            <FieldLabel htmlFor="audit-env">Environment</FieldLabel>
            <Select
              value={search.env ?? ALL}
              onValueChange={(value) => setSearch({ env: value === ALL ? undefined : value })}
            >
              <SelectTrigger id="audit-env" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All environments</SelectItem>
                {project.environments.map((env) => (
                  <SelectItem key={env.id} value={env.key}>
                    <EnvDot env={env} />
                    {env.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="audit-type">Entity</FieldLabel>
            <Select
              value={search.type ?? ALL}
              onValueChange={(value) =>
                setSearch({
                  type: value === ALL ? undefined : (value as (typeof ENTITY_TYPES)[number]),
                })
              }
            >
              <SelectTrigger id="audit-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All entities</SelectItem>
                {ENTITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {ENTITY_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="audit-action">Action</FieldLabel>
            <Input
              id="audit-action"
              value={actionText}
              onChange={(event) => onActionChange(event.target.value)}
              placeholder="flag.*"
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
            />
            <FieldDescription>e.g. flag.*</FieldDescription>
          </Field>
          <Field data-invalid={rangeInvalid || undefined}>
            <FieldLabel htmlFor="audit-from">From</FieldLabel>
            <Input
              id="audit-from"
              type="datetime-local"
              value={search.from ?? ''}
              max={search.to || undefined}
              onChange={(event) => setSearch({ from: event.target.value || undefined })}
              aria-invalid={rangeInvalid || undefined}
            />
          </Field>
          <Field data-invalid={rangeInvalid || undefined}>
            <FieldLabel htmlFor="audit-to">To</FieldLabel>
            <Input
              id="audit-to"
              type="datetime-local"
              value={search.to ?? ''}
              min={search.from || undefined}
              onChange={(event) => setSearch({ to: event.target.value || undefined })}
              aria-invalid={rangeInvalid || undefined}
            />
          </Field>
        </FieldGroup>
        {rangeInvalid ? (
          <p className="mt-3 text-destructive text-sm" role="alert">
            The start of the range is after its end.
          </p>
        ) : null}
        {filtered ? (
          <div className="mt-3">
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <FilterXIcon /> Clear filters
            </Button>
          </div>
        ) : null}
      </form>

      <AuditFeed
        // Restart pagination whenever the filters (and therefore the first page) change.
        key={JSON.stringify(search)}
        firstPage={page}
        query={toQuery(project, search)}
        filtered={filtered}
        onClear={clearFilters}
      />
    </div>
  )
}

function AuditFeed({
  firstPage,
  query,
  filtered,
  onClear,
}: {
  firstPage: {
    items: React.ComponentProps<typeof AuditTimeline>['items']
    nextCursor: string | null
  }
  query: ReturnType<typeof toQuery>
  filtered: boolean
  onClear: () => void
}) {
  const [items, setItems] = useState(firstPage.items)
  const [cursor, setCursor] = useState(firstPage.nextCursor)
  const [loading, setLoading] = useState(false)

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const next = await listAuditLog({ data: { ...query, cursor } })
      setItems((current) => [...current, ...next.items])
      setCursor(next.nextCursor)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load more entries')
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0 && filtered) {
    return (
      <Empty className="rounded-lg border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FilterXIcon />
          </EmptyMedia>
          <EmptyTitle>No matching entries</EmptyTitle>
          <EmptyDescription>Nothing in the audit log matches these filters.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <AuditTimeline items={items} />
      {cursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {loading ? <Spinner /> : null}
            Load more
          </Button>
        </div>
      ) : items.length > 0 ? (
        <p className="text-center text-muted-foreground text-xs">End of the audit log</p>
      ) : null}
    </div>
  )
}
