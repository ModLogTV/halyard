import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon, SearchIcon, UsersIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { translate } from '@/lib/i18n'
import { listSegments } from '@/server/functions/segments'

const projectRoute = getRouteApi('/app/$projectSlug')

export const Route = createFileRoute('/app/$projectSlug/segments/')({
  staticData: { crumbKey: 'segments' },
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData?.project.id
    if (!projectId) return { segments: [] }
    return { segments: await listSegments({ data: { projectId } }) }
  },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('segments:list.pageTitle') }],
  }),
  pendingComponent: SegmentsPending,
  component: SegmentsPage,
})

function SegmentsPending() {
  const { t } = useTranslation('segments')
  return (
    <div
      className="flex flex-col gap-6 p-6"
      role="status"
      aria-busy="true"
      aria-label={t('list.loading')}
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
  const { t, i18n } = useTranslation(['segments', 'flags', 'common'])
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
                <PlusIcon /> {t('list.newSegment')}
              </Link>
            ) : (
              <>
                <PlusIcon /> {t('list.newSegment')}
              </>
            )}
          </Button>
        </span>
      </TooltipTrigger>
      {canEdit ? null : <TooltipContent>{t('list.viewersCannotCreate')}</TooltipContent>}
    </Tooltip>
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t('list.title')}
        description={t('intro')}
        actions={segments.length > 0 ? newButton : null}
      />

      {segments.length === 0 ? (
        <Empty className="rounded-lg border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>{t('list.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('list.empty.description')}</EmptyDescription>
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
              placeholder={t('list.search.placeholder')}
              aria-label={t('list.search.ariaLabel')}
              className="pl-8"
            />
          </div>

          {filtered.length === 0 ? (
            <Empty className="rounded-lg border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>{t('list.noMatches.title')}</EmptyTitle>
                <EmptyDescription>
                  {t('list.noMatches.description', { query: query.trim() })}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => setQuery('')}>
                  {t('list.noMatches.clear')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common:labels.key')}</TableHead>
                    <TableHead>{t('common:labels.name')}</TableHead>
                    <TableHead>{t('list.columns.conditions')}</TableHead>
                    <TableHead>{t('list.columns.usedBy')}</TableHead>
                    <TableHead className="text-right">{t('common:labels.updated')}</TableHead>
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
                        <span title={describeConditions(segment.conditions, segment.match, t)}>
                          {describeConditions(segment.conditions, segment.match, t)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {segment.usageCount > 0 ? (
                          <Badge variant="secondary">
                            {t('common:counts.rules', { count: segment.usageCount })}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">{t('list.notUsed')}</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-right text-muted-foreground"
                        title={formatDateTime(segment.updatedAt, i18n.language)}
                      >
                        {formatRelativeTime(segment.updatedAt, { locale: i18n.language })}
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
