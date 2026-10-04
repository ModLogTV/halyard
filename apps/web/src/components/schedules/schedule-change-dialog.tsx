import { type FlagType, type Serve, type Variant, WEIGHT_TOLERANCE } from '@halyard/engine'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnvBadge, EnvDot, envStyle } from '@/components/env/env-badge'
import { HazardBand } from '@/components/env/hazard-band'
import { FlagTypeBadge, ServeEditor, sumWeights, VariantSelect } from '@/components/flags'
import { errorMessage } from '@/components/settings/form-utils'
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { listFlags } from '@/server/functions/flags'
import { createScheduledChange, createStagedRollout } from '@/server/functions/scheduled-changes'
import { DateTimePicker } from './date-time-picker'
import { defaultSteps, StagedStepsEditor } from './staged-steps-editor'
import { useNow } from './use-now'
import {
  type DraftStep,
  formatDelta,
  formatFullDateTime,
  HOUR,
  localTimeZone,
  roundedFromNow,
  validateSteps,
} from './utils'

const projectRoute = getRouteApi('/app/$projectSlug')

/** A flag as the dialog needs it. `FlagListItem` and `FlagDetail` both fit. */
export interface ScheduleFlag {
  key: string
  name: string
  type: FlagType
  variants: Variant[]
  /** Current defaults per environment; used to start the "Change default" editor. */
  environments?: { environmentKey: string; fallthrough: Serve }[]
}

export interface ScheduleChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-fills and locks the flag select. */
  flag?: ScheduleFlag
  /** Pre-selects the environment. */
  environmentKey?: string
}

type Mode = 'single' | 'staged'
type Action = 'on' | 'off' | 'serve'
const ACTIONS: Action[] = ['on', 'off', 'serve']

export function ScheduleChangeDialog({
  open,
  onOpenChange,
  flag,
  environmentKey,
}: ScheduleChangeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        <ScheduleForm
          flag={flag}
          environmentKey={environmentKey}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function currentFallthrough(flag: ScheduleFlag | undefined, envKey: string): Serve {
  const current = flag?.environments?.find((e) => e.environmentKey === envKey)?.fallthrough
  if (current) return current
  return { type: 'variant', variant: flag?.variants[0]?.key ?? '' }
}

/** The variant a staged rollout most likely ramps: `true` for booleans, else the second one. */
function defaultRampVariant(flag: ScheduleFlag | undefined): string {
  if (!flag) return ''
  if (flag.type === 'boolean') {
    const on = flag.variants.find((v) => v.value === true)
    if (on) return on.key
  }
  return (flag.variants[1] ?? flag.variants[0])?.key ?? ''
}

function ScheduleForm({
  flag: lockedFlag,
  environmentKey,
  onDone,
}: {
  flag?: ScheduleFlag
  environmentKey?: string
  onDone: () => void
}) {
  const { t, i18n } = useTranslation(['schedules', 'common'])
  const { project } = projectRoute.useLoaderData()
  const router = useRouter()
  const now = useNow(15_000)
  const environments = useMemo(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )

  const [flags, setFlags] = useState<ScheduleFlag[] | null>(lockedFlag ? [lockedFlag] : null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('single')
  const [flagKey, setFlagKey] = useState(lockedFlag?.key ?? '')
  const [envKey, setEnvKey] = useState(
    environments.find((e) => e.key === environmentKey)?.key ?? environments[0]?.key ?? '',
  )
  const [action, setAction] = useState<Action>('on')
  const [serve, setServe] = useState<Serve>(() => currentFallthrough(lockedFlag, envKey))
  const [at, setAt] = useState<Date>(() => roundedFromNow(HOUR))
  const [rampVariant, setRampVariant] = useState(() => defaultRampVariant(lockedFlag))
  const [steps, setSteps] = useState<DraftStep[]>(() => defaultSteps())
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (lockedFlag) return
    let cancelled = false
    listFlags({ data: { projectId: project.id } })
      .then((list) => {
        if (!cancelled) setFlags(list.filter((f) => !f.archivedAt))
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error, t('dialog.loadFlagsFailed')))
      })
    return () => {
      cancelled = true
    }
  }, [lockedFlag, project.id, t])

  const flag = flags?.find((f) => f.key === flagKey)
  const env = environments.find((e) => e.key === envKey)

  function chooseFlag(key: string) {
    const next = flags?.find((f) => f.key === key)
    setFlagKey(key)
    setServe(currentFallthrough(next, envKey))
    setRampVariant(defaultRampVariant(next))
  }

  function chooseEnvironment(key: string) {
    setEnvKey(key)
    setServe(currentFallthrough(flag, key))
  }

  // Validation -------------------------------------------------------------
  const nowMs = now.getTime()
  const timeError = at.getTime() <= nowMs ? t('validation.timeInFuture') : undefined
  const serveError = (() => {
    if (action !== 'serve' || !flag) return undefined
    if (serve.type === 'variant') {
      return flag.variants.some((v) => v.key === serve.variant)
        ? undefined
        : t('dialog.chooseVariantError')
    }
    return Math.abs(sumWeights(serve.variations) - 100) <= WEIGHT_TOLERANCE
      ? undefined
      : t('dialog.weightsError')
  })()
  const stepProblems = validateSteps(steps, t, nowMs)
  const stepsValid = stepProblems.every((p) => !p.at && !p.percentage)
  const rampError =
    mode === 'staged' && flag && flag.variants.length < 2
      ? t('dialog.rampNeedsVariants')
      : mode === 'staged' && flag && !flag.variants.some((v) => v.key === rampVariant)
        ? t('dialog.rampChooseVariant')
        : undefined
  const flagError = !flag ? t('dialog.chooseFlagError') : undefined
  const envError = !env ? t('dialog.chooseEnvironmentError') : undefined

  const valid =
    !flagError &&
    !envError &&
    (mode === 'single' ? !timeError && !serveError : stepsValid && !rampError)

  async function submit() {
    if (!flag || !env) return
    setPending(true)
    setServerError(null)
    const base = {
      projectId: project.id,
      flagKey: flag.key,
      environmentKey: env.key,
      note: note.trim() || undefined,
    }
    try {
      if (mode === 'single') {
        await createScheduledChange({
          data: {
            ...base,
            scheduledFor: at,
            change: action === 'serve' ? { fallthrough: serve } : { enabled: action === 'on' },
          },
        })
        toast.success(t('dialog.toastScheduled', { time: formatFullDateTime(at, i18n.language) }))
      } else {
        await createStagedRollout({
          data: {
            ...base,
            variant: rampVariant,
            steps: steps.map((s) => ({ percentage: Number(s.percentage), at: s.at })),
          },
        })
        toast.success(t('dialog.toastStagedScheduled', { count: steps.length }))
      }
      await router.invalidate()
      onDone()
    } catch (error) {
      setServerError(errorMessage(error, t('dialog.scheduleFailed')))
    } finally {
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (!valid || pending) return
    if (env?.isProduction) setConfirmOpen(true)
    else void submit()
  }

  const showErrors = submitted
  const firstStepAt = steps[0]?.at

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList className="w-full">
            <TabsTrigger value="single">{t('dialog.modeSingle')}</TabsTrigger>
            <TabsTrigger value="staged">{t('dialog.modeStaged')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={showErrors && flagError ? true : undefined}>
              <FieldLabel htmlFor="schedule-flag">{t('common:labels.flag')}</FieldLabel>
              {flags === null && !loadError ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={flagKey} onValueChange={chooseFlag} disabled={Boolean(lockedFlag)}>
                  <SelectTrigger
                    id="schedule-flag"
                    className="w-full"
                    aria-invalid={(showErrors && Boolean(flagError)) || undefined}
                  >
                    <SelectValue placeholder={t('dialog.chooseFlag')} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-72">
                    {(flags ?? []).map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-xs">{f.key}</span>
                          <FlagTypeBadge type={f.type} />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {loadError ? <FieldError>{loadError}</FieldError> : null}
              {showErrors && flagError ? <FieldError>{flagError}</FieldError> : null}
            </Field>

            <Field data-invalid={showErrors && envError ? true : undefined}>
              <FieldLabel htmlFor="schedule-env">{t('common:labels.environment')}</FieldLabel>
              <Select value={envKey} onValueChange={chooseEnvironment}>
                <SelectTrigger id="schedule-env" className="w-full">
                  <SelectValue placeholder={t('dialog.chooseEnvironment')} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {environments.map((e) => (
                    <SelectItem key={e.key} value={e.key}>
                      <EnvDot env={e} />
                      {e.name}
                      {e.isProduction ? (
                        <span className="text-muted-foreground text-xs">
                          {t('common:states.production').toLowerCase()}
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {env?.isProduction ? (
            <div
              style={envStyle(env)}
              className="flex items-start gap-3 rounded-lg border border-(--env-color)/50 bg-card p-3 text-sm"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-(--env-color)" />
              <div>
                <p className="font-medium">{t('dialog.productionTitle')}</p>
                <p className="text-muted-foreground">{t('dialog.productionBody')}</p>
              </div>
            </div>
          ) : null}

          {mode === 'single' ? (
            <>
              <FieldSet>
                <FieldLegend variant="label">{t('dialog.whatChanges')}</FieldLegend>
                <RadioGroup
                  value={action}
                  onValueChange={(value) => setAction(value as Action)}
                  className="grid gap-2 sm:grid-cols-3"
                >
                  {ACTIONS.map((value) => (
                    <label
                      key={value}
                      htmlFor={`schedule-action-${value}`}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40"
                    >
                      <RadioGroupItem
                        id={`schedule-action-${value}`}
                        value={value}
                        className="mt-0.5"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium text-sm">
                          {t(`dialog.action.${value}.title`)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t(`dialog.action.${value}.hint`)}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </FieldSet>

              {action === 'serve' && flag ? (
                <Field data-invalid={showErrors && serveError ? true : undefined}>
                  <ServeEditor
                    flag={flag}
                    value={serve}
                    onChange={setServe}
                    label={t('dialog.defaultForEveryone')}
                  />
                  {showErrors && serveError ? <FieldError>{serveError}</FieldError> : null}
                </Field>
              ) : null}

              <Field data-invalid={timeError ? true : undefined}>
                <FieldLabel htmlFor="schedule-at">{t('dialog.when')}</FieldLabel>
                <DateTimePicker
                  id="schedule-at"
                  value={at}
                  onChange={setAt}
                  invalid={Boolean(timeError)}
                  aria-label={t('dialog.runAt')}
                />
                {timeError ? (
                  <FieldError>{timeError}</FieldError>
                ) : (
                  <FieldDescription>
                    {t('dialog.runsAt', {
                      time: formatFullDateTime(at, i18n.language),
                      delta: formatDelta(at, now, i18n.language),
                      timeZone: localTimeZone(t('dialog.localTime')),
                    })}
                  </FieldDescription>
                )}
              </Field>
            </>
          ) : (
            <>
              <Field data-invalid={rampError ? true : undefined}>
                <FieldLabel htmlFor="schedule-variant">{t('dialog.rampVariant')}</FieldLabel>
                <VariantSelect
                  id="schedule-variant"
                  variants={flag?.variants ?? []}
                  type={flag?.type}
                  value={rampVariant}
                  onValueChange={setRampVariant}
                  disabled={!flag}
                  placeholder={flag ? t('dialog.chooseVariant') : t('dialog.chooseFlagFirst')}
                  aria-invalid={Boolean(rampError) || undefined}
                />
                {rampError && (showErrors || flag) ? <FieldError>{rampError}</FieldError> : null}
                <FieldDescription>{t('dialog.rampHelp')}</FieldDescription>
              </Field>

              <Field>
                <FieldLabel>{t('dialog.steps')}</FieldLabel>
                <StagedStepsEditor
                  steps={steps}
                  onChange={setSteps}
                  variants={flag?.variants ?? []}
                  variant={rampVariant}
                  problems={stepProblems}
                  now={now}
                />
                <FieldDescription>
                  {firstStepAt
                    ? t('dialog.startsAt', {
                        time: formatFullDateTime(firstStepAt, i18n.language),
                        delta: formatDelta(firstStepAt, now, i18n.language),
                        timeZone: localTimeZone(t('dialog.localTime')),
                      })
                    : t('dialog.addAtLeastOneStep')}
                </FieldDescription>
              </Field>
            </>
          )}

          <Field>
            <FieldLabel htmlFor="schedule-note">{t('dialog.note')}</FieldLabel>
            <Textarea
              id="schedule-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('dialog.notePlaceholder')}
            />
          </Field>

          {serverError ? <FieldError>{serverError}</FieldError> : null}
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={pending || (showErrors && !valid)}>
            {pending ? <Spinner /> : null}
            {mode === 'single' ? t('dialog.submitSingle') : t('dialog.submitStaged')}
          </Button>
        </DialogFooter>
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent style={env ? envStyle(env) : undefined}>
          <HazardBand />
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-5 text-(--env-color)" /> {t('dialog.confirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <Trans
                  t={t}
                  i18nKey={
                    mode === 'single' ? 'dialog.confirmBodySingle' : 'dialog.confirmBodyStaged'
                  }
                  values={{
                    ...(mode === 'staged' ? { count: steps.length } : {}),
                    flag: flag?.key ?? '',
                    delta: formatDelta(
                      mode === 'single' ? at : (firstStepAt ?? at),
                      now,
                      i18n.language,
                    ),
                  }}
                  components={[
                    <span key="flag" className="font-mono text-foreground" />,
                    env ? (
                      <EnvBadge key="env" env={env} className="align-middle" />
                    ) : (
                      <span key="env" />
                    ),
                  ]}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.goBack')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                void submit()
              }}
            >
              {t('dialog.confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
