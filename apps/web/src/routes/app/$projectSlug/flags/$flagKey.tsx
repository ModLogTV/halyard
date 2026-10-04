import type { FlagDefinition, FlagEnvironmentConfig, Variant } from '@halyard/engine'
import {
  createFileRoute,
  getRouteApi,
  Link,
  notFound,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  CalendarClockIcon,
  CheckIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { AuditTimeline } from '@/components/audit'
import { EnvBadge, EnvDot, envStyle } from '@/components/env/env-badge'
import {
  FlagTypeBadge,
  TagInput,
  TargetingEditor,
  useTargetingProblems,
  VariantsEditor,
  VariantValue,
} from '@/components/flags'
import { PageHeader } from '@/components/layout/page-header'
import { ScheduleChangeDialog } from '@/components/schedules'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { assessStaleness, describeStaleReason } from '@/lib/stale'
import { listFlagHistory } from '@/server/functions/audit-log'
import {
  archiveFlag,
  deleteFlag,
  getFlag,
  toggleFlag,
  unarchiveFlag,
  updateFlag,
  updateFlagEnvironment,
} from '@/server/functions/flags'
import { listScheduledChanges } from '@/server/functions/scheduled-changes'
import { listSegments } from '@/server/functions/segments'

const projectRoute = getRouteApi('/app/$projectSlug')

export const Route = createFileRoute('/app/$projectSlug/flags/$flagKey')({
  validateSearch: z.object({
    env: z.string().optional().catch(undefined),
    tab: z.enum(['targeting', 'history']).optional().catch(undefined),
  }),
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData!.project.id
    const [flag, segments, history, pendingSchedules] = await Promise.all([
      getFlag({ data: { projectId, flagKey: params.flagKey } }).catch(() => null),
      listSegments({ data: { projectId } }),
      listFlagHistory({ data: { projectId, flagKey: params.flagKey, limit: 50 } }).catch(() => ({
        items: [],
        nextCursor: null,
      })),
      listScheduledChanges({
        data: { projectId, flagKey: params.flagKey, status: 'pending' },
      }).catch(() => []),
    ])
    if (!flag) throw notFound()
    return { flag, segments, history, pendingSchedules, crumb: flag.key }
  },
  pendingComponent: () => (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="mt-4 h-10 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </div>
  ),
  component: FlagDetailPage,
})

type FlagDetail = Awaited<ReturnType<typeof getFlag>>
type EnvironmentDetail = FlagDetail['environments'][number]

function FlagDetailPage() {
  const { flag, segments, history, pendingSchedules } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const canEdit = project.role !== 'viewer'
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const environments = useMemo(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )
  const activeEnv = environments.find((e) => e.key === search.env) ?? environments[0]
  const definition: FlagDefinition = { key: flag.key, type: flag.type, variants: flag.variants }
  const staleness = assessStaleness(
    flag,
    flag.stats,
    environments.map((e) => e.id),
    {
      staleAfterDays: project.staleAfterDays,
      singleVariantAfterDays: project.singleVariantAfterDays,
    },
  )

  async function copyKey() {
    await navigator.clipboard.writeText(flag.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action()
      toast.success(success)
      await router.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/flags" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> Flags
          </Link>
        </Button>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{flag.key}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={copyKey}
                    aria-label="Copy flag key"
                  >
                    {copied ? <CheckIcon className="text-on" /> : <CopyIcon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copied ? 'Copied' : 'Copy key'}</TooltipContent>
              </Tooltip>
              <FlagTypeBadge type={flag.type} />
              {flag.archivedAt ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <ArchiveIcon className="size-3" /> Archived
                </Badge>
              ) : null}
            </span>
          }
          description={
            <span className="flex flex-col gap-1">
              <span className="text-foreground">{flag.name}</span>
              {flag.description ? <span>{flag.description}</span> : null}
              {flag.tags.length > 0 ? (
                <span className="flex flex-wrap gap-1 pt-1">
                  {flag.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="font-normal">
                      {t}
                    </Badge>
                  ))}
                </span>
              ) : null}
            </span>
          }
          actions={
            canEdit ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Flag actions">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <PencilIcon /> Edit details and variants
                  </DropdownMenuItem>
                  {flag.archivedAt ? null : (
                    <DropdownMenuItem onClick={() => setScheduling(true)}>
                      <CalendarClockIcon /> Schedule a change…
                    </DropdownMenuItem>
                  )}
                  {flag.archivedAt ? (
                    <DropdownMenuItem
                      onClick={() =>
                        run(
                          () =>
                            unarchiveFlag({ data: { projectId: project.id, flagKey: flag.key } }),
                          'Flag restored',
                        )
                      }
                    >
                      <ArchiveRestoreIcon /> Restore from archive
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() =>
                        run(
                          () => archiveFlag({ data: { projectId: project.id, flagKey: flag.key } }),
                          'Flag archived',
                        )
                      }
                    >
                      <ArchiveIcon /> Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2Icon /> Delete flag
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null
          }
        />
      </div>

      {staleness.stale ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Cleanup candidate</p>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {staleness.reasons.map((r) => {
                const text = describeStaleReason(
                  r,
                  (id) => environments.find((e) => e.id === id)?.name ?? '?',
                )
                return <li key={text}>{text}</li>
              })}
            </ul>
          </div>
        </div>
      ) : null}

      {pendingSchedules.length > 0 ? (
        <Alert>
          <CalendarClockIcon />
          <AlertDescription>
            <p>
              {pendingSchedules.length === 1
                ? '1 scheduled change pending for this flag'
                : `${pendingSchedules.length} scheduled changes pending for this flag`}{' '}
              —{' '}
              <Link
                to="/app/$projectSlug/schedules"
                params={{ projectSlug: project.slug }}
                search={{ flag: flag.key }}
                className="font-medium text-foreground underline underline-offset-4"
              >
                view
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Tabs
          value={search.tab ?? 'targeting'}
          onValueChange={(tab) =>
            navigate({
              search: (p) => ({ ...p, tab: tab as 'targeting' | 'history' }),
              replace: true,
            })
          }
        >
          <TabsList>
            <TabsTrigger value="targeting">Targeting</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="targeting" className="mt-4">
            <Tabs
              value={activeEnv?.key}
              onValueChange={(env) => navigate({ search: (p) => ({ ...p, env }), replace: true })}
            >
              <TabsList variant="line" className="w-full justify-start">
                {environments.map((env) => {
                  const config = flag.environments.find((c) => c.environmentId === env.id)
                  return (
                    <TabsTrigger
                      key={env.id}
                      value={env.key}
                      className="gap-2"
                      style={envStyle(env)}
                    >
                      <EnvDot env={env} />
                      {env.name}
                      <span
                        className={`size-1.5 rounded-full ${config?.enabled ? 'bg-on' : 'bg-off'}`}
                        aria-hidden="true"
                      />
                      <span className="sr-only">{config?.enabled ? 'on' : 'off'}</span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
              {environments.map((env) => {
                const config = flag.environments.find((c) => c.environmentId === env.id)
                if (!config) return null
                return (
                  <TabsContent key={env.id} value={env.key} className="mt-4">
                    <EnvironmentEditor
                      key={`${env.id}:${config.version}`}
                      projectId={project.id}
                      definition={definition}
                      environment={env}
                      config={config}
                      segments={segments.map((s) => ({ key: s.key, name: s.name }))}
                      disabled={!canEdit || Boolean(flag.archivedAt)}
                    />
                  </TabsContent>
                )
              })}
            </Tabs>
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <AuditTimeline items={history.items as never} />
          </TabsContent>
        </Tabs>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Variants</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {flag.variants.map((v, i) => (
                <VariantValue
                  key={v.key}
                  variantKey={v.key}
                  value={v.value}
                  type={flag.type}
                  index={i}
                />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {environments.map((env) => {
                const stat = flag.stats.find((s) => s.environmentId === env.id)
                return (
                  <div key={env.id} className="flex items-start justify-between gap-2">
                    <EnvBadge env={env} />
                    <div className="text-right text-xs text-muted-foreground">
                      {stat ? (
                        <>
                          <div title={formatDateTime(stat.lastEvaluatedAt)}>
                            {formatRelativeTime(stat.lastEvaluatedAt)}
                          </div>
                          <div className="tabular">
                            {stat.evaluationCount.toLocaleString()} evaluations
                          </div>
                        </>
                      ) : (
                        <div>Never evaluated</div>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="border-t pt-3 text-xs text-muted-foreground">
                Created {formatRelativeTime(flag.createdAt)} · Updated{' '}
                {formatRelativeTime(flag.updatedAt)}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <EditFlagDialog open={editing} onOpenChange={setEditing} flag={flag} projectId={project.id} />
      <ScheduleChangeDialog
        open={scheduling}
        onOpenChange={setScheduling}
        flag={flag}
        environmentKey={activeEnv?.key}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {flag.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the flag and its configuration in every environment. SDKs evaluating it
              will receive their code default. Consider archiving instead if you want to keep the
              history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                try {
                  await deleteFlag({ data: { projectId: project.id, flagKey: flag.key } })
                  toast.success(`Flag ${flag.key} deleted`)
                  await router.invalidate()
                  await navigate({
                    to: '/app/$projectSlug/flags',
                    params: { projectSlug: project.slug },
                  })
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'Could not delete the flag')
                }
              }}
            >
              Delete flag
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function toConfig(config: EnvironmentDetail): FlagEnvironmentConfig {
  return {
    enabled: config.enabled,
    offVariant: config.offVariant,
    rules: config.rules,
    fallthrough: config.fallthrough,
  }
}

function EnvironmentEditor({
  projectId,
  definition,
  environment,
  config,
  segments,
  disabled,
}: {
  projectId: string
  definition: FlagDefinition
  environment: { id: string; key: string; name: string; color: string; isProduction: boolean }
  config: EnvironmentDetail
  segments: { key: string; name: string }[]
  disabled: boolean
}) {
  const router = useRouter()
  const initial = useMemo(() => toConfig(config), [config])
  const [draft, setDraft] = useState<FlagEnvironmentConfig>(initial)
  const [saving, setSaving] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmToggle, setConfirmToggle] = useState<boolean | null>(null)
  const problems = useTargetingProblems(
    definition,
    draft,
    segments.map((s) => s.key),
  )
  const dirty = JSON.stringify({ ...draft, enabled: initial.enabled }) !== JSON.stringify(initial)

  async function applyToggle(enabled: boolean) {
    try {
      await toggleFlag({
        data: { projectId, flagKey: definition.key, environmentKey: environment.key, enabled },
      })
      toast.success(`${definition.key} is now ${enabled ? 'on' : 'off'} in ${environment.name}`)
      await router.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the flag')
    }
  }

  async function save() {
    setSaving(true)
    try {
      await updateFlagEnvironment({
        data: {
          projectId,
          flagKey: definition.key,
          environmentKey: environment.key,
          patch: {
            offVariant: draft.offVariant,
            fallthrough: draft.fallthrough,
            rules: draft.rules,
          },
          expectedVersion: config.version,
        },
      })
      toast.success(`Targeting saved for ${environment.name}`)
      await router.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save targeting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      {config.hasRunningExperiment ? (
        <div className="mb-4 rounded-lg border bg-info-soft p-3 text-sm">
          An experiment is running on this flag in {environment.name}. Contexts that reach the
          default are allocated by the experiment.
        </div>
      ) : null}
      <TargetingEditor
        flag={definition}
        value={draft}
        onChange={setDraft}
        segments={segments}
        environment={environment}
        disabled={disabled}
        onToggleRequest={(enabled) => {
          if (environment.isProduction) setConfirmToggle(enabled)
          else void applyToggle(enabled)
        }}
      />

      <AnimatePresence>
        {dirty ? (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="sticky bottom-4 z-10 mt-6"
          >
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-lg env-rail ${environment.isProduction ? 'hazard-stripes' : ''}`}
              style={envStyle(environment)}
            >
              <div className="flex items-center gap-2 text-sm">
                <EnvBadge env={environment} />
                <span>Unsaved targeting changes</span>
                {!problems.isValid ? (
                  <span className="text-destructive">· fix the problems above to save</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setDraft(initial)} disabled={saving}>
                  Discard
                </Button>
                <Button
                  onClick={() => (environment.isProduction ? setConfirmSave(true) : save())}
                  disabled={!problems.isValid || saving}
                >
                  {saving ? <Spinner /> : null}
                  Save to {environment.name}
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent style={envStyle(environment)}>
          <div className="hazard-stripes -mx-6 -mt-6 mb-2 h-2 rounded-t-lg" aria-hidden="true" />
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-5 text-(--env-color)" /> Save targeting to
              production?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Rules for <span className="font-mono text-foreground">{definition.key}</span> change
              immediately for everyone evaluating it in{' '}
              <EnvBadge env={environment} className="align-middle" />. You can review the change
              afterwards in the flag history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSave(false)
                void save()
              }}
            >
              Save to production
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmToggle !== null}
        onOpenChange={(open) => !open && setConfirmToggle(null)}
      >
        <AlertDialogContent style={envStyle(environment)}>
          <div className="hazard-stripes -mx-6 -mt-6 mb-2 h-2 rounded-t-lg" aria-hidden="true" />
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-5 text-(--env-color)" />
              {confirmToggle ? 'Enable' : 'Disable'} in production?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono text-foreground">{definition.key}</span> will be turned{' '}
              <strong>{confirmToggle ? 'on' : 'off'}</strong> for everyone in production
              immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = confirmToggle
                setConfirmToggle(null)
                if (next !== null) void applyToggle(next)
              }}
            >
              {confirmToggle ? 'Enable in production' : 'Disable in production'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EditFlagDialog({
  open,
  onOpenChange,
  flag,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flag: FlagDetail
  projectId: string
}) {
  const router = useRouter()
  const [name, setName] = useState(flag.name)
  const [description, setDescription] = useState(flag.description ?? '')
  const [tags, setTags] = useState<string[]>(flag.tags)
  const [variants, setVariants] = useState<Variant[]>(flag.variants)
  const [variantsValid, setVariantsValid] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lockedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const env of flag.environments) {
      keys.add(env.offVariant)
      if (env.fallthrough.type === 'variant') keys.add(env.fallthrough.variant)
      else for (const v of env.fallthrough.variations) if (v.weight > 0) keys.add(v.variant)
      for (const rule of env.rules) {
        if (rule.serve.type === 'variant') keys.add(rule.serve.variant)
        else for (const v of rule.serve.variations) if (v.weight > 0) keys.add(v.variant)
      }
    }
    return Array.from(keys)
  }, [flag.environments])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await updateFlag({
        data: {
          projectId,
          flagKey: flag.key,
          patch: { name: name.trim(), description: description.trim() || null, tags, variants },
        },
      })
      toast.success('Flag updated')
      await router.invalidate()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the flag')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Edit {flag.key}</DialogTitle>
            <DialogDescription>
              Variants referenced by a rule or default in any environment cannot be removed or
              renamed.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-6">
            <Field>
              <FieldLabel htmlFor="edit-name">Name</FieldLabel>
              <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-description">Description</FieldLabel>
              <Textarea
                id="edit-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Tags</FieldLabel>
              <TagInput
                aria-label="Tags"
                values={tags}
                onChange={setTags}
                placeholder="Add a tag and press Enter"
              />
            </Field>
            <Field>
              <FieldLabel>Variants</FieldLabel>
              <VariantsEditor
                type={flag.type}
                value={variants}
                onChange={setVariants}
                lockedKeys={lockedKeys}
                onValidityChange={setVariantsValid}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !variantsValid || !name.trim()}>
              {pending ? <Spinner /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
