import { validateSegment } from '@halyard/engine'
import {
  createFileRoute,
  getRouteApi,
  Link,
  notFound,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { ArrowLeftIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import {
  DeleteSegmentDialog,
  type SegmentDraft,
  SegmentEditor,
  SegmentUsagesCard,
} from '@/components/segments'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { deleteSegment, getSegment, updateSegment } from '@/server/functions/segments'

const projectRoute = getRouteApi('/app/$projectSlug')

export const Route = createFileRoute('/app/$projectSlug/segments/$segmentKey')({
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData?.project.id
    if (!projectId) throw notFound()
    try {
      const segment = await getSegment({ data: { projectId, segmentKey: params.segmentKey } })
      return { crumb: segment.key, segment }
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) throw notFound()
      throw error
    }
  },
  head: ({ params }) => ({ meta: [{ title: `${params.segmentKey} · Segments · Halyard` }] }),
  component: SegmentDetailPage,
})

function SegmentDetailPage() {
  const { segment } = Route.useLoaderData()
  // Remount the editor after a save or refetch so the baseline always matches the server.
  return <SegmentDetail key={`${segment.id}:${String(segment.updatedAt)}`} />
}

function toDraft(segment: ReturnType<typeof Route.useLoaderData>['segment']): SegmentDraft {
  return {
    key: segment.key,
    name: segment.name,
    description: segment.description ?? '',
    match: segment.match,
    conditions: segment.conditions,
  }
}

const sameDraft = (a: SegmentDraft, b: SegmentDraft) =>
  a.name === b.name &&
  a.description === b.description &&
  a.match === b.match &&
  JSON.stringify(a.conditions) === JSON.stringify(b.conditions)

function SegmentDetail() {
  const { segment } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const canEdit = project.role !== 'viewer'

  const [baseline] = useState(() => toDraft(segment))
  const [draft, setDraft] = useState<SegmentDraft>(baseline)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const dirty = !sameDraft(draft, baseline)
  const problems = validateSegment({
    key: draft.key,
    match: draft.match,
    conditions: draft.conditions,
  })
  const valid = problems.length === 0 && draft.name.trim() !== ''

  async function save() {
    if (!dirty || !valid || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await updateSegment({
        data: {
          projectId: project.id,
          segmentKey: segment.key,
          patch: {
            name: draft.name.trim(),
            description: draft.description.trim() || null,
            match: draft.match,
            conditions: draft.conditions,
          },
        },
      })
      toast.success('Segment saved')
      await router.invalidate()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the segment'
      setSaveError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteSegment({ data: { projectId: project.id, segmentKey: segment.key } })
      toast.success(`Segment "${segment.key}" deleted`)
      setDeleteOpen(false)
      await router.invalidate()
      await navigate({ to: '/app/$projectSlug/segments', params: { projectSlug: project.slug } })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not delete the segment'
      setDeleteError(message)
      toast.error(message)
      // The usages may have changed since this page loaded; refresh so the dialog lists them.
      await router.invalidate()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/segments" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> All segments
          </Link>
        </Button>
        <PageHeader
          title={segment.name}
          description={
            <span title={formatDateTime(segment.updatedAt)}>
              <span className="font-mono">{segment.key}</span> · updated{' '}
              {formatRelativeTime(segment.updatedAt)}
            </span>
          }
          actions={
            canEdit ? (
              <>
                {dirty ? (
                  <Badge variant="outline" className="gap-1.5">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
                    Unsaved changes
                  </Badge>
                ) : null}
                {dirty ? (
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setDraft(baseline)
                      setSaveError(null)
                    }}
                  >
                    Discard
                  </Button>
                ) : null}
                <Button onClick={save} disabled={!dirty || !valid || saving}>
                  {saving ? <Spinner /> : null}
                  Save changes
                </Button>
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" aria-label="Segment actions">
                          <MoreHorizontalIcon aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Segment actions</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        setDeleteError(null)
                        setDeleteOpen(true)
                      }}
                    >
                      <Trash2Icon aria-hidden="true" />
                      Delete segment
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null
          }
        />
      </div>

      {canEdit ? null : (
        <Alert>
          <AlertTitle>Read-only access</AlertTitle>
          <AlertDescription>
            Viewers can inspect segments but not change them. Ask an editor or owner.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          className="flex flex-col gap-6"
        >
          <SegmentEditor
            mode="edit"
            value={draft}
            onChange={setDraft}
            disabled={!canEdit || saving}
            problems={problems.filter((problem) => !problem.startsWith('Segment key'))}
          />
          {saveError ? (
            <p className="text-destructive text-sm" role="alert">
              {saveError}
            </p>
          ) : null}
        </form>

        <aside className="lg:sticky lg:top-6">
          <SegmentUsagesCard
            usages={segment.usages}
            projectSlug={project.slug}
            environments={project.environments}
          />
        </aside>
      </div>

      <DeleteSegmentDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        segmentKey={segment.key}
        usages={segment.usages}
        projectSlug={project.slug}
        environments={project.environments}
        pending={deleting}
        error={deleteError}
        onConfirm={remove}
      />
    </div>
  )
}
