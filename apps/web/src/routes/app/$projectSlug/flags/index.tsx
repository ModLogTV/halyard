import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { FlagIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { FLAG_TYPES, FlagFilters } from '@/components/flags/flag-filters'
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
import { Skeleton } from '@/components/ui/skeleton'
import { translate } from '@/lib/i18n'
import { assessStaleness } from '@/lib/stale'
import { listFlags, toggleFlag } from '@/server/functions/flags'

const projectRoute = getRouteApi('/app/$projectSlug')

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  types: z.array(z.enum(FLAG_TYPES)).optional().catch(undefined),
  tags: z.array(z.string()).optional().catch(undefined),
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
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('flags:list.pageTitle') }],
  }),
  pendingComponent: FlagsPending,
  component: FlagsPage,
})

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e', 'f']

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
  const { t } = useTranslation(['flags', 'common'])
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
      if (search.types?.length && !search.types.includes(row.type)) return false
      if (search.tags?.length && !search.tags.some((tag) => row.tags.includes(tag))) return false
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
      toast.success(
        t(enabled ? 'list.toggledOn' : 'list.toggledOff', {
          flagKey: flag.key,
          environment: environment.name,
        }),
      )
      await router.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('list.toggleFailed'))
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title={t('list.title')}
        description={t('list.description', {
          flags: t('common:counts.flags', { count: flags.filter((f) => !f.archivedAt).length }),
          environments: t('common:counts.environments', { count: environments.length }),
        })}
        actions={
          canEdit ? (
            <Button asChild>
              <Link to="/app/$projectSlug/flags/new" params={{ projectSlug: project.slug }}>
                <PlusIcon /> {t('list.newFlag')}
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
            placeholder={t('list.filters.searchPlaceholder')}
            value={search.q ?? ''}
            onChange={(e) => setSearch({ q: e.target.value || undefined })}
            aria-label={t('list.filters.searchLabel')}
          />
        </InputGroup>
        <FlagFilters
          value={{
            types: search.types ?? [],
            tags: search.tags ?? [],
            stale: Boolean(search.stale),
            archived: Boolean(search.archived),
          }}
          allTags={allTags}
          staleCount={staleCount}
          staleHelp={t('list.filters.staleHelp', {
            staleDays: project.staleAfterDays,
            singleVariantDays: project.singleVariantAfterDays,
          })}
          onChange={(patch) =>
            setSearch({
              ...(patch.types !== undefined
                ? { types: patch.types.length > 0 ? patch.types : undefined }
                : {}),
              ...(patch.tags !== undefined
                ? { tags: patch.tags.length > 0 ? patch.tags : undefined }
                : {}),
              ...(patch.stale !== undefined ? { stale: patch.stale || undefined } : {}),
              ...(patch.archived !== undefined ? { archived: patch.archived || undefined } : {}),
            })
          }
          onClear={() =>
            setSearch({ types: undefined, tags: undefined, stale: undefined, archived: undefined })
          }
        />
      </div>

      {flags.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlagIcon />
            </EmptyMedia>
            <EmptyTitle>{t('list.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('list.empty.description')}</EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <EmptyContent>
              <Button asChild>
                <Link to="/app/$projectSlug/flags/new" params={{ projectSlug: project.slug }}>
                  <PlusIcon /> {t('list.empty.create')}
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
            <EmptyTitle>{t('list.noMatches.title')}</EmptyTitle>
            <EmptyDescription>{t('list.noMatches.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => navigate({ search: {}, replace: true })}>
              {t('common:actions.clearFilters')}
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
