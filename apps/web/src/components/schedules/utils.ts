import type { RolloutVariation, Serve, Variant } from '@modlogtv/halyard-engine'
import type { TFunction } from 'i18next'
import { formatPercent, formatRelativeTime } from '@/lib/format'
import type { ScheduledChangeItem } from '@/server/services/scheduled-changes'

export type { ScheduledChangeItem }

/** Translate function of components that call `useTranslation(['schedules', 'common'])`. */
export type ScheduleT = TFunction<['schedules', 'common']>

export type ScheduleStatus = ScheduledChangeItem['status']

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** A date `offsetMs` from now, rounded up to the next full 5 minutes. */
export function roundedFromNow(offsetMs: number, now = Date.now()): Date {
  const step = 5 * MINUTE
  return new Date(Math.ceil((now + offsetMs) / step) * step)
}

/** "in 5 min.", "in 2 hr.", "in 3 days" for the future, the usual "ago" wording for the past; localised. */
export function formatDelta(
  date: Date | string | number,
  now: Date = new Date(),
  locale?: string,
): string {
  const target = new Date(date)
  const seconds = Math.round((target.getTime() - now.getTime()) / 1000)
  if (seconds <= 0) return formatRelativeTime(target, { now, locale })
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (seconds < 45) return rtf.format(0, 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return rtf.format(Math.max(1, minutes), 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 60) return rtf.format(days, 'day')
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(target)
}

/** The viewer's time zone, e.g. "Europe/Berlin". */
export function localTimeZone(fallback = 'local time'): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return fallback
  }
}

/** `Mon, Oct 5, 2026, 3:00 PM` in the viewer's locale and time zone. */
export function formatFullDateTime(date: Date | string | number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(
    new Date(date),
  )
}

export function formatTimeOfDay(date: Date | string | number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(date))
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** "Today", "Tomorrow", "Yesterday", otherwise "Mon, Oct 5". */
export function formatDayHeading(
  date: Date,
  t: ScheduleT,
  locale?: string,
  now: Date = new Date(),
): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(date) - startOf(now)) / DAY)
  const long = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date)
  if (diff === 0) return t('dayHeading.today', { date: long })
  if (diff === 1) return t('dayHeading.tomorrow', { date: long })
  if (diff === -1) return t('dayHeading.yesterday', { date: long })
  return long
}

/**
 * The fallthrough of one staged rollout step. Mirrors the server: `variant` gets
 * `percentage` and comes first, the other variants share the remainder evenly.
 */
export function stagedRolloutServe(
  variantKeys: string[],
  variant: string,
  percentage: number,
): Extract<Serve, { type: 'rollout' }> {
  const others = variantKeys.filter((key) => key !== variant)
  const remainder = Math.round((100 - percentage) * 1000)
  const base = others.length > 0 ? Math.floor(remainder / others.length) : 0
  const extra = remainder - base * others.length
  return {
    type: 'rollout',
    variations: [
      { variant, weight: percentage },
      ...others.map((key, index) => ({
        variant: key,
        weight: (base + (index < extra ? 1 : 0)) / 1000,
      })),
    ],
  }
}

/** Variants to colour a rollout bar when the flag itself is not at hand. */
export function syntheticVariants(variations: RolloutVariation[]): Variant[] {
  return variations.map((v) => ({ key: v.variant, value: v.variant }))
}

export function describeRollout(variations: RolloutVariation[]): string {
  const shown = variations.filter((v) => v.weight > 0)
  return (shown.length > 0 ? shown : variations)
    .map((v) => `${v.variant} ${formatPercent(v.weight)}`)
    .join(' / ')
}

export interface ChangeSummaryParts {
  labels: string[]
  rollout: RolloutVariation[] | null
}

/** Human summary of a scheduled change payload, one label per part. */
export function summarizeChange(
  change: ScheduledChangeItem['change'],
  t: ScheduleT,
): ChangeSummaryParts {
  const labels: string[] = []
  let rollout: RolloutVariation[] | null = null
  if (change.enabled !== undefined)
    labels.push(change.enabled ? t('summary.turnOn') : t('summary.turnOff'))
  if (change.fallthrough) {
    if (change.fallthrough.type === 'variant') {
      labels.push(t('summary.defaultVariant', { variant: change.fallthrough.variant }))
    } else {
      rollout = change.fallthrough.variations
      labels.push(t('summary.rollout', { rollout: describeRollout(change.fallthrough.variations) }))
    }
  }
  if (change.rules) {
    labels.push(
      change.rules.length === 0
        ? t('summary.removeAllRules')
        : t('summary.replaceRules', { count: change.rules.length }),
    )
  }
  return { labels, rollout }
}

export interface StagedStepInfo {
  variant: string
  variantKeys: string[]
  percentage: number
}

/** Reads a staged rollout step back out of its payload; null for anything else. */
export function stagedStepInfo(item: ScheduledChangeItem): StagedStepInfo | null {
  const serve = item.change.fallthrough
  if (!item.planId || serve?.type !== 'rollout') return null
  const first = serve.variations[0]
  if (!first) return null
  return {
    variant: first.variant,
    variantKeys: serve.variations.map((v) => v.variant),
    percentage: first.weight,
  }
}

export function planSteps(items: ScheduledChangeItem[], planId: string): ScheduledChangeItem[] {
  return items.filter((item) => item.planId === planId).sort((a, b) => a.stepIndex - b.stepIndex)
}

export interface DraftStep {
  id: string
  /** Kept as text so the input can be edited freely. */
  percentage: string
  at: Date
}

export interface StepProblems {
  percentage?: string
  at?: string
}

/** Per-step validation: percentage within 0 to 100, times in the future and strictly increasing. */
export function validateSteps(
  steps: DraftStep[],
  t: ScheduleT,
  now: number = Date.now(),
): StepProblems[] {
  return steps.map((step, index) => {
    const problems: StepProblems = {}
    const percentage = Number(step.percentage)
    if (step.percentage.trim() === '' || !Number.isFinite(percentage)) {
      problems.percentage = t('validation.enterPercentage')
    } else if (percentage < 0 || percentage > 100) {
      problems.percentage = t('validation.percentageRange')
    }
    const previous = steps[index - 1]
    if (step.at.getTime() <= now) problems.at = t('validation.timeInFuture')
    else if (previous && step.at.getTime() <= previous.at.getTime()) {
      problems.at = t('validation.afterPreviousStep')
    }
    return problems
  })
}
