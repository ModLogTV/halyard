import type { JsonValue } from '@modlogtv/halyard-engine'
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { PlayIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { EnvDot } from '@/components/env/env-badge'
import { PageHeader } from '@/components/layout/page-header'
import {
  AllFlagsResult,
  BackToAll,
  type ContextDraft,
  ContextEditor,
  type ContextPreset,
  contextToDraft,
  decodeContext,
  draftToContext,
  emptyDraft,
  encodeContext,
  FlagPicker,
  loadPresets,
  PresetChips,
  ResultEmpty,
  ResultError,
  ResultSkeleton,
  SavePresetButton,
  SingleResult,
  savePresets,
} from '@/components/playground'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Kbd } from '@/components/ui/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { listFlags } from '@/server/functions/flags'
import { evaluatePlayground, type PlaygroundResult } from '@/server/functions/playground'

const projectRoute = getRouteApi('/app/$projectSlug')

const searchSchema = z.object({
  env: z.string().optional().catch(undefined),
  flag: z.string().optional().catch(undefined),
  ctx: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/app/$projectSlug/playground')({
  staticData: { crumbKey: 'playground' },
  validateSearch: searchSchema,
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const flags = await listFlags({
      data: { projectId: parent.loaderData!.project.id, includeArchived: false },
    })
    return { flags: flags.map((f) => ({ key: f.key, name: f.name, type: f.type })) }
  },
  pendingComponent: PlaygroundPending,
  component: PlaygroundPage,
})

function PlaygroundPending() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-80" />
      <div className="mt-2 grid gap-6 lg:grid-cols-[26rem_1fr]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  )
}

type Run =
  | { status: 'idle' }
  | { status: 'loading'; previous?: PlaygroundResult; flagKey?: string }
  | { status: 'success'; data: PlaygroundResult; flagKey?: string; id: number }
  | { status: 'error'; message: string }

function PlaygroundPage() {
  const { t } = useTranslation(['playground', 'common'])
  const { flags } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const environments = useMemo(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )
  const environment = environments.find((e) => e.key === search.env) ?? environments[0]
  const flagKey = search.flag && flags.some((f) => f.key === search.flag) ? search.flag : undefined

  const [draft, setDraft] = useState<ContextDraft>(() => {
    const decoded = decodeContext(search.ctx)
    return decoded ? contextToDraft(decoded) : emptyDraft()
  })
  const [resetKey, setResetKey] = useState(0)
  const [saved, setSaved] = useState<ContextPreset[]>([])
  const [run, setRun] = useState<Run>({ status: 'idle' })
  const requestId = useRef(0)

  const built = useMemo(() => draftToContext(draft), [draft])
  const hasErrors = Object.keys(built.errors).length > 0

  useEffect(() => {
    setSaved(loadPresets(project.id))
  }, [project.id])

  // Keep the context in the URL so results are shareable.
  const encoded = useMemo(() => encodeContext(built.context), [built.context])
  useEffect(() => {
    if (encoded === search.ctx) return
    const timer = window.setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, ctx: encoded }),
        replace: true,
        viewTransition: false,
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [encoded, search.ctx, navigate])

  const evaluate = useCallback(
    async (overrides?: { flagKey?: string | null; environmentKey?: string }) => {
      if (!environment) return
      if (hasErrors) {
        toast.error(t('page.fixAttributes'))
        return
      }
      const key = overrides?.flagKey === undefined ? flagKey : (overrides.flagKey ?? undefined)
      const environmentKey = overrides?.environmentKey ?? environment.key
      const id = ++requestId.current
      setRun((current) => ({
        status: 'loading',
        previous:
          current.status === 'success'
            ? current.data
            : current.status === 'loading'
              ? current.previous
              : undefined,
        flagKey: key,
      }))
      try {
        const data = await evaluatePlayground({
          data: {
            projectId: project.id,
            environmentKey,
            flagKey: key,
            context: built.context as Record<string, JsonValue>,
          },
        })
        if (id !== requestId.current) return
        setRun({ status: 'success', data, flagKey: key, id })
      } catch (error) {
        if (id !== requestId.current) return
        const message = error instanceof Error ? error.message : t('page.evaluationFailed')
        toast.error(message)
        setRun({ status: 'error', message })
      }
    },
    [environment, flagKey, hasErrors, project.id, built.context, t],
  )

  // ⌘↵ / Ctrl+↵ evaluates from anywhere on the page.
  const evaluateRef = useRef(evaluate)
  evaluateRef.current = evaluate
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void evaluateRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // A shared link with a context shows its result right away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount
  useEffect(() => {
    if (search.ctx && decodeContext(search.ctx)) void evaluateRef.current()
  }, [])

  const setSearch = (patch: { env?: string; flag?: string | undefined }) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, viewTransition: false })

  const reevaluate = run.status !== 'idle'

  function onEnvironmentChange(key: string) {
    void setSearch({ env: key })
    if (reevaluate) void evaluate({ environmentKey: key })
  }

  function onFlagChange(key: string | undefined) {
    void setSearch({ flag: key })
    if (reevaluate) void evaluate({ flagKey: key ?? null })
  }

  function applyPreset(preset: ContextPreset) {
    setDraft(contextToDraft(preset.context))
    setResetKey((k) => k + 1)
    toast(t('page.presetLoaded', { name: preset.name }))
  }

  function savePreset(name: string) {
    if (hasErrors) {
      toast.error(t('page.fixAttributes'))
      return
    }
    const preset: ContextPreset = {
      id: `saved:${Date.now().toString(36)}`,
      name,
      context: built.context as ContextPreset['context'],
    }
    const next = [...saved, preset]
    setSaved(next)
    savePresets(project.id, next)
    toast.success(t('page.presetSaved', { name }))
  }

  function deletePreset(preset: ContextPreset) {
    const next = saved.filter((p) => p.id !== preset.id)
    setSaved(next)
    savePresets(project.id, next)
    toast(t('page.presetDeleted', { name: preset.name }))
  }

  const shown =
    run.status === 'success' ? run.data : run.status === 'loading' ? run.previous : undefined
  const shownFlagKey =
    run.status === 'success' || run.status === 'loading' ? run.flagKey : undefined
  const loading = run.status === 'loading'
  const resultEnvironment =
    environments.find((e) => e.key === shown?.environment.key) ?? environment
  const single = shown && shownFlagKey ? shown.results[0] : undefined

  if (!environment) {
    return (
      <div className="p-6">
        <PageHeader title={t('common:labels.playground')} description={t('page.noEnvironments')} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={t('common:labels.playground')} description={t('page.description')} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t('page.contextTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span id="pg-env-label" className="text-sm font-medium">
                  {t('common:labels.environment')}
                </span>
                <Select value={environment.key} onValueChange={onEnvironmentChange}>
                  <SelectTrigger className="w-full" aria-labelledby="pg-env-label">
                    <SelectValue>
                      <EnvDot env={environment} /> {environment.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {environments.map((e) => (
                      <SelectItem key={e.key} value={e.key}>
                        <EnvDot env={e} /> {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pg-flag" className="text-sm font-medium">
                  {t('common:labels.flag')}
                </label>
                <FlagPicker id="pg-flag" flags={flags} value={flagKey} onChange={onFlagChange} />
              </div>
            </div>

            <ContextEditor draft={draft} onChange={setDraft} resetKey={resetKey} built={built} />

            <PresetChips saved={saved} onApply={applyPreset} onDelete={deletePreset} />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void evaluate()} disabled={loading}>
                {loading ? <Spinner /> : <PlayIcon />} {t('page.evaluate')}
                <span
                  className="ml-1 hidden items-center gap-0.5 sm:inline-flex"
                  aria-hidden="true"
                >
                  <Kbd className="bg-primary-foreground/20 text-primary-foreground">⌘</Kbd>
                  <Kbd className="bg-primary-foreground/20 text-primary-foreground">↵</Kbd>
                </span>
              </Button>
              <SavePresetButton disabled={hasErrors} onSave={savePreset} />
            </div>
          </CardContent>
        </Card>

        <section
          aria-label={t('result.title')}
          aria-live="polite"
          className="flex min-w-0 flex-col gap-3"
        >
          <h2 className="text-sm font-medium text-muted-foreground">{t('result.title')}</h2>
          {run.status === 'idle' ? (
            <ResultEmpty>
              {flags.length === 0 ? (
                <Button asChild variant="outline" size="sm">
                  <Link to="/app/$projectSlug/flags/new" params={{ projectSlug: project.slug }}>
                    {t('page.createFlag')}
                  </Link>
                </Button>
              ) : null}
            </ResultEmpty>
          ) : run.status === 'error' ? (
            <ResultError message={run.message} />
          ) : loading && !shown ? (
            <ResultSkeleton />
          ) : shown && single && resultEnvironment ? (
            <>
              <BackToAll onClick={() => onFlagChange(undefined)} />
              <SingleResult
                result={single}
                environment={resultEnvironment}
                evaluationId={run.status === 'success' ? run.id : requestId.current}
                stale={loading}
              />
            </>
          ) : shown ? (
            <AllFlagsResult
              results={shown.results}
              stale={loading}
              onSelect={(key) => onFlagChange(key)}
            />
          ) : null}
        </section>
      </div>
    </div>
  )
}
