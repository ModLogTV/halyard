import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import {
  ArrowUpFromLineIcon,
  FlagIcon,
  GitCompareArrowsIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import {
  type CompareEnvironment,
  CompareMatrix,
  cellDiffers,
  type FlagSummaryRow,
  PromoteDialog,
  type PromoteFlag,
} from '@/components/compare'
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
import { Toggle } from '@/components/ui/toggle'
import { pluralize } from '@/lib/format'
import { listFlags } from '@/server/functions/flags'

const projectRoute = getRouteApi('/app/$projectSlug')

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  baseline: z.string().optional().catch(undefined),
  /** Show identical rows too. */
  all: z.boolean().optional().catch(undefined),
})

export const Route = createFileRoute('/app/$projectSlug/compare')({
  staticData: { crumb: 'Compare' },
  validateSearch: searchSchema,
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const flags = await listFlags({
      data: { projectId: parent.loaderData!.project.id, includeArchived: false },
    })
    return { flags }
  },
  pendingComponent: ComparePending,
  component: ComparePage,
})

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e']

function ComparePending() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="rounded-lg border">
        {SKELETON_ROWS.map((id) => (
          <div key={id} className="flex items-center gap-6 border-b px-4 py-4 last:border-0">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-10 w-32" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}

interface DialogState {
  id: number
  flags: PromoteFlag[]
  from: string
  to: string
}

function ComparePage() {
  const { flags } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()

  const environments = useMemo<CompareEnvironment[]>(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )
  const baseline = environments.find((e) => e.key === search.baseline) ?? environments[0]
  const showAll = Boolean(search.all)
  const canPromote = project.role !== 'viewer'

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const rows = flags as FlagSummaryRow[]

  const filtered = useMemo(() => {
    const q = search.q?.trim().toLowerCase()
    return rows.filter((flag) => {
      if (q && !`${flag.key} ${flag.name}`.toLowerCase().includes(q)) return false
      if (!showAll && baseline) {
        return environments.some((e) => cellDiffers(flag, e, baseline))
      }
      return true
    })
  }, [rows, search.q, showAll, baseline, environments])

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, viewTransition: false })

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openDialog(flagKeys: string[], fromKey: string, toKey: string) {
    setDialog({
      id: Date.now(),
      flags: flagKeys.flatMap((key) => {
        const flag = rows.find((f) => f.key === key)
        return flag ? [{ key: flag.key, name: flag.name }] : []
      }),
      from: fromKey,
      to: toKey,
    })
    setDialogOpen(true)
  }

  function promoteSelected() {
    if (!baseline) return
    const baselineIndex = environments.findIndex((e) => e.id === baseline.id)
    const target = environments[baselineIndex + 1] ?? environments.find((e) => e.id !== baseline.id)
    if (!target) return
    openDialog(
      rows.filter((f) => selected.has(f.key)).map((f) => f.key),
      baseline.key,
      target.key,
    )
  }

  const promoteDisabledReason = canPromote ? undefined : 'Only editors and owners can promote flags'
  const selectedCount = rows.filter((f) => selected.has(f.key)).length

  if (flags.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <PageHeader title="Compare" description="See how flags differ between environments." />
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlagIcon />
            </EmptyMedia>
            <EmptyTitle>No flags to compare</EmptyTitle>
            <EmptyDescription>
              Create a flag first. Then you can compare it across environments and promote its
              configuration.
            </EmptyDescription>
          </EmptyHeader>
          {canPromote ? (
            <EmptyContent>
              <Button asChild>
                <Link to="/app/$projectSlug/flags/new" params={{ projectSlug: project.slug }}>
                  <PlusIcon /> Create a flag
                </Link>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </div>
    )
  }

  if (environments.length < 2 || !baseline) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <PageHeader title="Compare" description="See how flags differ between environments." />
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitCompareArrowsIcon />
            </EmptyMedia>
            <EmptyTitle>Add a second environment</EmptyTitle>
            <EmptyDescription>
              Comparison needs at least two environments. Add one in the project settings.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link
                to="/app/$projectSlug/settings/environments"
                params={{ projectSlug: project.slug }}
              >
                Manage environments
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Compare"
        description={`${pluralize(flags.length, 'active flag')} across ${pluralize(environments.length, 'environment')}. Tinted cells differ from the ${baseline.name} baseline.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search by key or name"
            value={search.q ?? ''}
            onChange={(e) => setSearch({ q: e.target.value || undefined })}
            aria-label="Search flags"
          />
        </InputGroup>
        <Toggle
          variant="outline"
          size="sm"
          pressed={!showAll}
          onPressedChange={(pressed) => setSearch({ all: pressed ? undefined : true })}
          aria-label="Only show differences"
          className="data-[state=on]:bg-warning-soft"
        >
          Only show differences
        </Toggle>
        <span className="tabular text-xs text-muted-foreground">
          {filtered.length} of {flags.length} flags
        </span>
        {search.q ? (
          <Button variant="ghost" size="sm" onClick={() => setSearch({ q: undefined })}>
            <XIcon /> Clear search
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {selectedCount > 0 ? (
            <>
              <span className="tabular text-sm text-muted-foreground">
                {selectedCount} selected
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button
                size="sm"
                disabled={!canPromote}
                onClick={promoteSelected}
                title={promoteDisabledReason}
              >
                <ArrowUpFromLineIcon /> Promote selected
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>
              {!showAll && !search.q ? 'Every environment matches' : 'No flags match'}
            </EmptyTitle>
            <EmptyDescription>
              {!showAll && !search.q
                ? `No flag differs from ${baseline.name} in on/off state, default or rule count.`
                : 'Try a different search.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, q: undefined, all: true }),
                  replace: true,
                })
              }
            >
              Show all flags
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <CompareMatrix
          projectId={project.id}
          projectSlug={project.slug}
          flags={filtered}
          environments={environments}
          baseline={baseline}
          onBaselineChange={(key) => setSearch({ baseline: key })}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          selected={selected}
          onSelectedChange={setSelected}
          promoteDisabledReason={promoteDisabledReason}
          onPromote={(flagKey, from, to) => openDialog([flagKey], from, to)}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Cells compare on/off state, the default and the number of rules. Expand a row to see rule
        level differences.
      </p>

      {dialog ? (
        <PromoteDialog
          key={dialog.id}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projectId={project.id}
          flags={dialog.flags}
          environments={environments}
          initialFrom={dialog.from}
          initialTo={dialog.to}
          onDone={() => {
            setSelected(new Set())
            void router.invalidate()
          }}
        />
      ) : null}
    </div>
  )
}
