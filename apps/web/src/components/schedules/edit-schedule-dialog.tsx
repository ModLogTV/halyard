import { getRouteApi, useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnvBadge } from '@/components/env/env-badge'
import { RolloutBar } from '@/components/flags'
import { errorMessage } from '@/components/settings/form-utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { updateScheduledChange } from '@/server/functions/scheduled-changes'
import { DateTimePicker } from './date-time-picker'
import { useNow } from './use-now'
import {
  formatDelta,
  formatFullDateTime,
  localTimeZone,
  type ScheduledChangeItem,
  stagedRolloutServe,
  stagedStepInfo,
  syntheticVariants,
} from './utils'

const projectRoute = getRouteApi('/app/$projectSlug')

export interface EditScheduleDialogProps {
  /** The change to edit; the dialog is closed while this is null. */
  item: ScheduledChangeItem | null
  /** Every loaded change; the steps of the same plan constrain the time. */
  all: ScheduledChangeItem[]
  onOpenChange: (open: boolean) => void
}

/** Change the time and note of a pending change, and the percentage of a rollout step. */
export function EditScheduleDialog({ item, all, onOpenChange }: EditScheduleDialogProps) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {item ? (
          <EditForm key={item.id} item={item} all={all} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  item,
  all,
  onDone,
}: {
  item: ScheduledChangeItem
  all: ScheduledChangeItem[]
  onDone: () => void
}) {
  const { t, i18n } = useTranslation(['schedules', 'common'])
  const { project } = projectRoute.useLoaderData()
  const router = useRouter()
  const now = useNow(15_000)
  const env = project.environments.find((e) => e.key === item.environmentKey)
  const step = stagedStepInfo(item)

  const [at, setAt] = useState(() => new Date(item.scheduledFor))
  const [note, setNote] = useState(item.note ?? '')
  const [percentage, setPercentage] = useState(step ? String(step.percentage) : '')
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const siblings = item.planId
    ? all
        .filter((other) => other.planId === item.planId && other.id !== item.id)
        .sort((a, b) => a.stepIndex - b.stepIndex)
    : []
  const previous = siblings.filter((s) => s.stepIndex < item.stepIndex).at(-1)
  const next = siblings.find((s) => s.stepIndex > item.stepIndex)

  const pct = Number(percentage)
  const percentageError = step
    ? percentage.trim() === '' || !Number.isFinite(pct) || pct < 0 || pct > 100
      ? t('validation.percentageRange')
      : undefined
    : undefined
  const timeError =
    at.getTime() <= now.getTime()
      ? t('validation.timeInFuture')
      : previous && at.getTime() <= new Date(previous.scheduledFor).getTime()
        ? t('validation.afterStep', {
            number: previous.stepIndex + 1,
            time: formatFullDateTime(previous.scheduledFor, i18n.language),
          })
        : next && at.getTime() >= new Date(next.scheduledFor).getTime()
          ? t('validation.beforeStep', {
              number: next.stepIndex + 1,
              time: formatFullDateTime(next.scheduledFor, i18n.language),
            })
          : undefined

  const preview =
    step && !percentageError ? stagedRolloutServe(step.variantKeys, step.variant, pct) : null

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (timeError || percentageError || pending) return
    const patch: Parameters<typeof updateScheduledChange>[0]['data']['patch'] = {}
    if (at.getTime() !== new Date(item.scheduledFor).getTime()) patch.scheduledFor = at
    if ((note.trim() || null) !== (item.note ?? null)) patch.note = note.trim() || null
    if (step && preview && pct !== step.percentage) {
      patch.change = { ...item.change, fallthrough: preview }
    }
    if (Object.keys(patch).length === 0) {
      onDone()
      return
    }
    setPending(true)
    setServerError(null)
    try {
      await updateScheduledChange({ data: { projectId: project.id, id: item.id, patch } })
      toast.success(t('edit.toastUpdated'))
      await router.invalidate()
      onDone()
    } catch (error) {
      setServerError(errorMessage(error, t('edit.updateFailed')))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>{t('edit.title')}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{item.flagKey}</span>
            {env ? <EnvBadge env={env} /> : null}
            {item.planId ? (
              <span>{t('edit.stepSuffix', { number: item.stepIndex + 1 })}</span>
            ) : null}
          </div>
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={timeError ? true : undefined}>
          <FieldLabel htmlFor="edit-schedule-at">{t('dialog.when')}</FieldLabel>
          <DateTimePicker
            id="edit-schedule-at"
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
        {step ? (
          <Field data-invalid={percentageError ? true : undefined}>
            <FieldLabel htmlFor="edit-schedule-percentage">
              {t('edit.percentageFor', { variant: step.variant })}
            </FieldLabel>
            <InputGroup className="w-32">
              <InputGroupInput
                id="edit-schedule-percentage"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="any"
                value={percentage}
                aria-invalid={Boolean(percentageError) || undefined}
                className="tabular-nums"
                onChange={(event) => setPercentage(event.target.value)}
              />
              <InputGroupAddon align="inline-end">%</InputGroupAddon>
            </InputGroup>
            {percentageError ? <FieldError>{percentageError}</FieldError> : null}
            {preview ? (
              <RolloutBar
                variations={preview.variations}
                variants={syntheticVariants(preview.variations)}
              />
            ) : null}
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="edit-schedule-note">{t('dialog.note')}</FieldLabel>
          <Textarea
            id="edit-schedule-note"
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
        <Button type="submit" disabled={pending || Boolean(timeError || percentageError)}>
          {pending ? <Spinner /> : null}
          {t('edit.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}
