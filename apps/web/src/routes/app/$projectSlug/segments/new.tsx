import { validateSegment } from '@modlogtv/halyard-engine'
import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/page-header'
import { EMPTY_SEGMENT_DRAFT, type SegmentDraft, SegmentEditor } from '@/components/segments'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { translate } from '@/lib/i18n'
import { createSegment } from '@/server/functions/segments'

const projectRoute = getRouteApi('/app/$projectSlug')

export const Route = createFileRoute('/app/$projectSlug/segments/new')({
  staticData: { crumbKey: 'newSegment' },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('segments:new.pageTitle') }],
  }),
  component: NewSegmentPage,
})

function keyFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '')
    .slice(0, 64)
}

function NewSegmentPage() {
  const { t } = useTranslation(['segments', 'common'])
  const { project } = projectRoute.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [draft, setDraft] = useState<SegmentDraft>(EMPTY_SEGMENT_DRAFT)
  const [keyTouched, setKeyTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = project.role !== 'viewer'

  const problems = validateSegment({
    key: draft.key,
    match: draft.match,
    conditions: draft.conditions,
  })
  const keyProblem =
    draft.key === '' && !keyTouched
      ? undefined
      : problems.find((problem) => problem.startsWith('Segment key'))
  const otherProblems = problems.filter((problem) => !problem.startsWith('Segment key'))
  const valid = problems.length === 0 && draft.name.trim() !== ''

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || pending) return
    setPending(true)
    setError(null)
    try {
      const segment = await createSegment({
        data: {
          projectId: project.id,
          key: draft.key,
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
          match: draft.match,
          conditions: draft.conditions,
        },
      })
      toast.success(t('new.created', { key: segment.key }))
      await router.invalidate()
      await navigate({
        to: '/app/$projectSlug/segments/$segmentKey',
        params: { projectSlug: project.slug, segmentKey: segment.key },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('new.createFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/segments" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> {t('backToList')}
          </Link>
        </Button>
        <PageHeader title={t('new.title')} description={t('intro')} />
      </div>

      {canEdit ? null : (
        <Alert>
          <AlertTitle>{t('readOnly.title')}</AlertTitle>
          <AlertDescription>{t('readOnly.create')}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
        <SegmentEditor
          mode="create"
          value={draft}
          disabled={!canEdit || pending}
          keyProblem={keyProblem}
          problems={otherProblems}
          onChange={setDraft}
          onNameChange={(name) =>
            setDraft((current) => ({
              ...current,
              name,
              key: keyTouched ? current.key : keyFromName(name),
            }))
          }
          onKeyChange={(key) => {
            setKeyTouched(true)
            setDraft((current) => ({ ...current, key: key.trim() }))
          }}
        />
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button asChild variant="ghost">
            <Link to="/app/$projectSlug/segments" params={{ projectSlug: project.slug }}>
              {t('common:actions.cancel')}
            </Link>
          </Button>
          <Button type="submit" disabled={!canEdit || !valid || pending}>
            {pending ? <Spinner /> : null}
            {t('new.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}
