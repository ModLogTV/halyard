import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  MinusCircleIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { JsonDiff } from '@/components/audit'
import { EnvBadge, EnvDot, envStyle } from '@/components/env/env-badge'
import { HazardBand } from '@/components/env/hazard-band'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { copyFlagEnvironment, getFlag } from '@/server/functions/flags'
import { configOf, type FlagDetailData } from './flag-detail'
import {
  applyFields,
  COPY_FIELDS,
  type CompareEnvironment,
  type CompareT,
  type CopyField,
  defaultFields,
  describeChanges,
  diffable,
} from './utils'

export interface PromoteFlag {
  key: string
  name: string
}

export interface PromoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  flags: PromoteFlag[]
  environments: CompareEnvironment[]
  /** Environment keys. */
  initialFrom: string
  initialTo: string
  /** Called once after promotions finished (also partially), to refresh data. */
  onDone: () => void
}

type Preview =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FlagDetailData }

type Outcome =
  | { status: 'pending' }
  | { status: 'running' }
  | { status: 'changed'; version: number }
  | { status: 'unchanged' }
  | { status: 'skipped' }
  | { status: 'error'; message: string }

const CONCURRENCY = 4

function EnvSelect({
  label,
  value,
  onChange,
  environments,
  disabledKey,
  disabled,
}: {
  label: string
  value: string
  onChange: (key: string) => void
  environments: CompareEnvironment[]
  disabledKey: string
  disabled?: boolean
}) {
  const selected = environments.find((e) => e.key === value)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue>
            {selected ? (
              <>
                <EnvDot env={selected} /> {selected.name}
              </>
            ) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {environments.map((e) => (
            <SelectItem key={e.key} value={e.key} disabled={e.key === disabledKey}>
              <EnvDot env={e} /> {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function OutcomeIcon({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation('compare')
  switch (outcome.status) {
    case 'running':
      return <Spinner className="size-4" />
    case 'changed':
      return (
        <CheckCircle2Icon
          className="size-4 text-on"
          aria-label={t('dialog.outcome.promotedLabel')}
        />
      )
    case 'unchanged':
    case 'skipped':
      return (
        <MinusCircleIcon
          className="size-4 text-muted-foreground"
          aria-label={t('dialog.outcome.noChangesLabel')}
        />
      )
    case 'error':
      return (
        <XCircleIcon
          className="size-4 text-destructive"
          aria-label={t('dialog.outcome.failedLabel')}
        />
      )
    default:
      return (
        <CircleDashedIcon
          className="size-4 text-muted-foreground"
          aria-label={t('dialog.outcome.waitingLabel')}
        />
      )
  }
}

function outcomeText(outcome: Outcome, t: CompareT): string {
  switch (outcome.status) {
    case 'pending':
      return t('dialog.outcome.pending')
    case 'running':
      return t('dialog.outcome.running')
    case 'changed':
      return t('dialog.outcome.changed', { version: outcome.version })
    case 'unchanged':
      return t('dialog.outcome.unchanged')
    case 'skipped':
      return t('dialog.outcome.skipped')
    case 'error':
      return outcome.message
  }
}

function FlagPreview({
  flag,
  preview,
  from,
  to,
  fields,
  outcome,
  showDiff,
  single,
}: {
  flag: PromoteFlag
  preview: Preview
  from: CompareEnvironment
  to: CompareEnvironment
  fields: CopyField[]
  outcome?: Outcome
  showDiff: boolean
  single: boolean
}) {
  const { t } = useTranslation(['compare', 'common'])
  const [diffOpen, setDiffOpen] = useState(single)
  const model = useMemo(() => {
    if (preview.status !== 'ready') return undefined
    const source = configOf(preview.data, from)
    const target = configOf(preview.data, to)
    if (!source || !target) return { missing: true as const }
    return {
      missing: false as const,
      lines: describeChanges(source, target, fields, t),
      before: diffable(target),
      after: diffable(applyFields(source, target, fields)),
    }
  }, [preview, from, to, fields, t])

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        {outcome ? <OutcomeIcon outcome={outcome} /> : null}
        <span className="min-w-0 truncate font-mono text-[13px] font-medium">{flag.key}</span>
        {outcome && outcome.status !== 'pending' ? (
          <span
            className={cn(
              'ml-auto text-xs',
              outcome.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {outcomeText(outcome, t)}
          </span>
        ) : null}
      </div>
      {preview.status === 'loading' ? (
        <Skeleton className="h-10 w-full" />
      ) : preview.status === 'error' ? (
        <p className="text-sm text-destructive">{preview.message}</p>
      ) : !model || model.missing ? (
        <p className="text-sm text-destructive">{t('dialog.missingConfig')}</p>
      ) : (
        <>
          {model.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('dialog.noChanges', { to: to.name, from: from.name })}
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {model.lines.map((line) => (
                <li key={line.field} className="flex items-baseline gap-2">
                  <span aria-hidden="true" className="text-muted-foreground">
                    •
                  </span>
                  <span>{line.text}</span>
                </li>
              ))}
            </ul>
          )}
          {showDiff && model.lines.length > 0 ? (
            <Collapsible open={diffOpen} onOpenChange={setDiffOpen}>
              <CollapsibleTrigger className="group/diff flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/diff:rotate-90" />
                {t('dialog.rawDiff')}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <JsonDiff before={model.before} after={model.after} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      )}
    </li>
  )
}

/**
 * Promotes the selected fields of one or many flags from one environment to another.
 * Previews each change from the loaded configurations, runs the copies one after the other
 * and lists a result per flag. Production targets require typing the environment key.
 */
export function PromoteDialog({
  open,
  onOpenChange,
  projectId,
  flags,
  environments,
  initialFrom,
  initialTo,
  onDone,
}: PromoteDialogProps) {
  const { t } = useTranslation(['compare', 'common'])
  const [fromKey, setFromKey] = useState(initialFrom)
  const [toKey, setToKey] = useState(initialTo)
  const from = environments.find((e) => e.key === fromKey) ?? environments[0]
  const to = environments.find((e) => e.key === toKey) ?? environments[0]
  const [fields, setFields] = useState<CopyField[]>(() =>
    defaultFields(environments.find((e) => e.key === initialTo)),
  )
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const [phase, setPhase] = useState<'review' | 'running' | 'done'>('review')
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [confirmation, setConfirmation] = useState('')
  const single = flags.length === 1
  const isDone = useRef(onDone)
  isDone.current = onDone

  // Load every flag's configuration for the preview, a few at a time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once per dialog instance
  useEffect(() => {
    let cancelled = false
    const queue = [...flags]
    setPreviews(Object.fromEntries(flags.map((f) => [f.key, { status: 'loading' } as Preview])))
    async function worker() {
      for (let flag = queue.shift(); flag; flag = queue.shift()) {
        const key = flag.key
        let next: Preview
        try {
          next = { status: 'ready', data: await getFlag({ data: { projectId, flagKey: key } }) }
        } catch (error) {
          next = {
            status: 'error',
            message: error instanceof Error ? error.message : t('detail.loadFailed'),
          }
        }
        if (cancelled) return
        setPreviews((current) => ({ ...current, [key]: next }))
      }
    }
    for (let i = 0; i < Math.min(CONCURRENCY, flags.length); i++) void worker()
    return () => {
      cancelled = true
    }
  }, [])

  const changeCounts = useMemo(() => {
    const counts: Record<string, number | undefined> = {}
    if (!from || !to) return counts
    for (const flag of flags) {
      const preview = previews[flag.key]
      if (preview?.status !== 'ready') continue
      const source = configOf(preview.data, from)
      const target = configOf(preview.data, to)
      if (source && target) counts[flag.key] = describeChanges(source, target, fields, t).length
    }
    return counts
  }, [flags, previews, from, to, fields, t])

  if (!from || !to) return null
  const sameEnv = from.key === to.key
  const needsConfirmation = to.isProduction
  const confirmed = !needsConfirmation || confirmation.trim() === to.key
  const loadingPreviews = flags.some(
    (f) => previews[f.key]?.status !== 'ready' && previews[f.key]?.status !== 'error',
  )
  const promotable = flags.filter((f) => (changeCounts[f.key] ?? 0) > 0)
  const busy = phase === 'running'
  const canConfirm =
    phase === 'review' &&
    !sameEnv &&
    fields.length > 0 &&
    !loadingPreviews &&
    promotable.length > 0 &&
    confirmed

  function setTo(key: string) {
    setToKey(key)
    setFields(defaultFields(environments.find((e) => e.key === key)))
    setConfirmation('')
  }

  function toggleField(field: CopyField, checked: boolean) {
    setFields((current) =>
      COPY_FIELDS.map((f) => f.key).filter((k) => (k === field ? checked : current.includes(k))),
    )
  }

  async function promote() {
    if (!from || !to) return
    setPhase('running')
    const initial: Record<string, Outcome> = {}
    for (const flag of flags) {
      initial[flag.key] = promotable.includes(flag) ? { status: 'pending' } : { status: 'skipped' }
    }
    setOutcomes(initial)
    let changed = 0
    let failed = 0
    for (const flag of promotable) {
      setOutcomes((current) => ({ ...current, [flag.key]: { status: 'running' } }))
      let outcome: Outcome
      try {
        const result = await copyFlagEnvironment({
          data: {
            projectId,
            flagKey: flag.key,
            fromEnvironmentKey: from.key,
            toEnvironmentKey: to.key,
            fields,
          },
        })
        if (result.changed) {
          changed += 1
          outcome = { status: 'changed', version: result.version }
        } else {
          outcome = { status: 'unchanged' }
        }
      } catch (error) {
        failed += 1
        outcome = {
          status: 'error',
          message: error instanceof Error ? error.message : t('dialog.promotionFailed'),
        }
      }
      setOutcomes((current) => ({ ...current, [flag.key]: outcome }))
    }
    setPhase('done')
    isDone.current()
    if (failed === 0) {
      toast.success(
        single
          ? changed > 0
            ? t('dialog.toast.promotedSingle', {
                flag: flags[0]?.key,
                from: from.name,
                to: to.name,
              })
            : t('dialog.toast.alreadyMatched', { flag: flags[0]?.key, to: to.name })
          : t('dialog.toast.promotedMany', { count: changed, from: from.name, to: to.name }),
      )
      if (single) onOpenChange(false)
    } else {
      toast.error(
        changed > 0
          ? t('dialog.toast.failedPartial', { count: failed, succeeded: changed })
          : t('dialog.toast.failed', { count: failed }),
      )
    }
  }

  const finished = promotable.filter((f) => {
    const status = outcomes[f.key]?.status
    return status !== undefined && status !== 'pending' && status !== 'running'
  }).length
  const progress = promotable.length === 0 ? 0 : Math.round((finished / promotable.length) * 100)

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent
        style={envStyle(to)}
        className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
        onInteractOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        {needsConfirmation ? <HazardBand /> : null}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {needsConfirmation ? <TriangleAlertIcon className="size-5 text-(--env-color)" /> : null}
            {single ? (
              <Trans
                t={t}
                i18nKey="dialog.titleSingle"
                values={{ flag: flags[0]?.key }}
                components={[<span key="flag" className="font-mono text-base" />]}
              />
            ) : (
              t('dialog.titleMany', { count: flags.length })
            )}
          </DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <EnvSelect
            label={t('dialog.from')}
            value={from.key}
            onChange={setFromKey}
            environments={environments}
            disabledKey={to.key}
            disabled={phase !== 'review'}
          />
          <ArrowRightIcon
            className="mb-2.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <EnvSelect
            label={t('dialog.to')}
            value={to.key}
            onChange={setTo}
            environments={environments}
            disabledKey={from.key}
            disabled={phase !== 'review'}
          />
        </div>

        <fieldset className="flex flex-col gap-2" disabled={phase !== 'review'}>
          <legend className="mb-1 text-sm font-medium">{t('dialog.fieldsLegend')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {COPY_FIELDS.map((field) => {
              const id = `promote-field-${field.key}`
              return (
                <label
                  key={field.key}
                  htmlFor={id}
                  className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                >
                  <Checkbox
                    id={id}
                    checked={fields.includes(field.key)}
                    onCheckedChange={(checked) => toggleField(field.key, checked === true)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{t(`copyFields.${field.key}.label`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`copyFields.${field.key}.hint`)}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          {to.isProduction && !fields.includes('enabled') ? (
            <p className="text-xs text-muted-foreground">{t('dialog.productionHint')}</p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {phase === 'review' ? t('dialog.preview') : t('dialog.progress')}
            </span>
            {!single ? (
              <span className="tabular text-xs text-muted-foreground">
                {t('dialog.withChanges', { promotable: promotable.length, total: flags.length })}
              </span>
            ) : null}
          </div>
          {phase !== 'review' ? (
            <Progress value={progress} aria-label={t('dialog.progressAriaLabel')} />
          ) : null}
          {sameEnv ? (
            <p className="text-sm text-muted-foreground">{t('dialog.chooseDifferent')}</p>
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dialog.selectAtLeastOne')}</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border p-3">
              {flags.map((flag) => (
                <FlagPreview
                  key={flag.key}
                  flag={flag}
                  preview={previews[flag.key] ?? { status: 'loading' }}
                  from={from}
                  to={to}
                  fields={fields}
                  outcome={outcomes[flag.key]}
                  showDiff
                  single={single}
                />
              ))}
            </ul>
          )}
        </div>

        {needsConfirmation && phase === 'review' ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-(--env-color)/40 bg-(--env-color)/5 p-3">
            <label htmlFor="promote-confirm" className="text-sm">
              <Trans
                t={t}
                i18nKey="dialog.confirmPrompt"
                values={{ key: to.key }}
                components={[
                  <EnvBadge key="env" env={to} className="align-middle" />,
                  <span key="key" className="font-mono font-semibold" />,
                ]}
              />
            </label>
            <Input
              id="promote-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={to.key}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
        ) : null}

        <DialogFooter>
          {phase === 'done' ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('common:actions.close')}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="button"
                variant={needsConfirmation ? 'destructive' : 'default'}
                disabled={!canConfirm}
                onClick={() => void promote()}
              >
                {busy ? <Spinner /> : null}
                {busy
                  ? t('dialog.promoting', { current: finished + 1, total: promotable.length })
                  : single
                    ? t('dialog.submitSingle', { environment: to.name })
                    : t('dialog.submitMany', { count: promotable.length, environment: to.name })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
