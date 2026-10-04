import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon, SearchIcon, UsersIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { describeConditions } from '@/components/segments/describe'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatRelativeTime, pluralize } from '@/lib/format'
import { listSegments } from '@/server/functions/segments'

const projectRoute = getRouteApi('/app/$projectSlug')

export const Route = createFileRoute('/app/$projectSlug/segments/')({
  staticData: { crumb: 'Segments' },
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData?.project.id
    if (!projectId) return { segments: [] }
    return { segments: await listSegments({ data: { projectId } }) }
  },
  head: () => ({ meta: [{ title: 'Segments · Halyard' }] }),
  pendingComponent: SegmentsPending,
  component: SegmentsPage,
})

function SegmentsPending() {
  return (
    <div
      className="flex flex-col gap-6 p-6"
      role="status"
      aria-busy="true"
      aria-label="Loading segments"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-9 w-72" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}

function SegmentsPage() {
  const { segments } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const canEdit = project.role !== 'viewer'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return segments
    return segments.filter(
      (segment) => segment.key.toLowerCase().includes(q) || segment.name.toLowerCase().includes(q),
    )
  }, [segments, query])

  const newButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span keeps the tooltip reachable while the button is disabled */}
        <span tabIndex={canEdit ? undefined : 0}>
          <Button asChild={canEdit} disabled={!canEdit}>
            {canEdit ? (
              <Link to="/app/$projectSlug/segments/new" params={{ projectSlug: project.slug }}>
                <PlusIcon /> New segment
              </Link>
            ) : (
              <>
                <PlusIcon /> New segment
              </>
            )}
          </Button>
        </span>
      </TooltipTrigger>
      {canEdit ? null : <TooltipContent>Viewers cannot create segments</TooltipContent>}
    </Tooltip>
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Segments"
        description="Reusable groups of users you can target from any flag."
        actions={segments.length > 0 ? newButton : null}
      />

      {segments.length === 0 ? (
        <Empty className="rounded-lg border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>No segments yet</EmptyTitle>
            <EmptyDescription>
              Define a group once, for example beta testers or internal staff, and target it from
              any flag rule.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newButton}</EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="relative w-full max-w-sm">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by key or name"
              aria-label="Search segments"
              className="pl-8"
            />
          </div>

          {filtered.length === 0 ? (
            <Empty className="rounded-lg border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>No matching segments</EmptyTitle>
                <EmptyDescription>Nothing matches "{query.trim()}".</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Conditions</TableHead>
                    <TableHead>Used by</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((segment) => (
                    <TableRow
                      key={segment.id}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate({
                          to: '/app/$projectSlug/segments/$segmentKey',
                          params: { projectSlug: project.slug, segmentKey: segment.key },
                        })
                      }
                    >
                      <TableCell className="font-mono text-xs">
                        <Link
                          to="/app/$projectSlug/segments/$segmentKey"
                          params={{ projectSlug: project.slug, segmentKey: segment.key }}
                          className="font-medium underline-offset-4 hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {segment.key}
                        </Link>
                      </TableCell>
                      <TableCell>{segment.name}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">
                        <span title={describeConditions(segment.conditions, segment.match)}>
                          {describeConditions(segment.conditions, segment.match)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {segment.usageCount > 0 ? (
                          <Badge variant="secondary">{pluralize(segment.usageCount, 'rule')}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">Not used</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-right text-muted-foreground"
                        title={formatDateTime(segment.updatedAt)}
                      >
                        {formatRelativeTime(segment.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
