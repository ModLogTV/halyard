/**
 * Stale flag detection.
 *
 * A flag is a cleanup candidate when, in every environment, it has either not
 * been evaluated for `staleAfterDays` or has returned the same variant to
 * everyone for `singleVariantAfterDays`. Flags created recently are not
 * penalised for having no evaluations yet.
 */

import type { TFunction } from 'i18next'

const DAY_MS = 24 * 60 * 60 * 1000

export interface StaleThresholds {
  staleAfterDays: number
  singleVariantAfterDays: number
}

export interface StaleStatsInput {
  environmentId: string
  lastEvaluatedAt: Date | string
  lastVariant: string | null
  sameVariantSince: Date | string
}

export type StaleReason =
  | { kind: 'never-evaluated'; days: number }
  | { kind: 'not-evaluated'; environmentId: string; days: number }
  | { kind: 'single-variant'; environmentId: string; variant: string | null; days: number }

export interface StaleAssessment {
  /** True when the flag is a cleanup candidate. */
  stale: boolean
  reasons: StaleReason[]
}

const ageInDays = (date: Date | string, now: number) =>
  Math.floor((now - new Date(date).getTime()) / DAY_MS)

export function assessStaleness(
  flag: { createdAt: Date | string; archivedAt?: Date | string | null },
  stats: StaleStatsInput[],
  environmentIds: string[],
  thresholds: StaleThresholds,
  now: number = Date.now(),
): StaleAssessment {
  if (flag.archivedAt) return { stale: false, reasons: [] }
  const reasons: StaleReason[] = []
  const flagAge = ageInDays(flag.createdAt, now)

  if (stats.length === 0) {
    if (flagAge >= thresholds.staleAfterDays) {
      reasons.push({ kind: 'never-evaluated', days: flagAge })
      return { stale: true, reasons }
    }
    return { stale: false, reasons }
  }

  const byEnv = new Map(stats.map((s) => [s.environmentId, s]))
  let everyEnvironmentStale = true
  for (const environmentId of environmentIds) {
    const entry = byEnv.get(environmentId)
    if (!entry) {
      // Never evaluated in this environment: counts as stale once the flag is old enough.
      if (flagAge >= thresholds.staleAfterDays) {
        reasons.push({ kind: 'not-evaluated', environmentId, days: flagAge })
      } else {
        everyEnvironmentStale = false
      }
      continue
    }
    const idle = ageInDays(entry.lastEvaluatedAt, now)
    const sameFor = ageInDays(entry.sameVariantSince, now)
    if (idle >= thresholds.staleAfterDays) {
      reasons.push({ kind: 'not-evaluated', environmentId, days: idle })
    } else if (sameFor >= thresholds.singleVariantAfterDays) {
      reasons.push({
        kind: 'single-variant',
        environmentId,
        variant: entry.lastVariant,
        days: sameFor,
      })
    } else {
      everyEnvironmentStale = false
    }
  }
  return { stale: everyEnvironmentStale && reasons.length > 0, reasons }
}

/** Human-readable, translated sentence for a stale reason. */
export function describeStaleReason(
  reason: StaleReason,
  environmentName: (id: string) => string,
  t: TFunction<['flags', 'common']>,
): string {
  switch (reason.kind) {
    case 'never-evaluated':
      return t('stale.reasons.neverEvaluated', { count: reason.days })
    case 'not-evaluated':
      return t('stale.reasons.notEvaluated', {
        environment: environmentName(reason.environmentId),
        count: reason.days,
      })
    case 'single-variant':
      return t('stale.reasons.singleVariant', {
        variant: reason.variant ?? t('stale.reasons.noVariant'),
        environment: environmentName(reason.environmentId),
        count: reason.days,
      })
  }
}
