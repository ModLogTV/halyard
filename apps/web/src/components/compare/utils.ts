import type {
  FlagEnvironmentConfig,
  FlagType,
  JsonValue,
  Rule,
  Serve,
  Variant,
} from '@halyard/engine'
import type { EnvironmentLike } from '@/components/env/env-badge'
import { formatPercent, pluralize } from '@/lib/format'

export interface CompareEnvironment extends EnvironmentLike {
  id: string
}

/** The evaluation-relevant part of a flag in one environment. */
export type EnvConfig = Pick<
  FlagEnvironmentConfig,
  'enabled' | 'offVariant' | 'fallthrough' | 'rules'
>

export type CopyField = 'enabled' | 'offVariant' | 'fallthrough' | 'rules'

export const COPY_FIELDS: { key: CopyField; label: string; hint: string }[] = [
  { key: 'enabled', label: 'Enabled', hint: 'Whether the flag is on' },
  { key: 'offVariant', label: 'Off variant', hint: 'Served while the flag is off' },
  { key: 'fallthrough', label: 'Default', hint: 'Served when no rule matches' },
  { key: 'rules', label: 'Rules', hint: 'All targeting rules, in order' },
]

/** Fields copied by default: everything, except `enabled` when the target is production. */
export function defaultFields(
  target: Pick<EnvironmentLike, 'isProduction'> | undefined,
): CopyField[] {
  return COPY_FIELDS.map((f) => f.key).filter((k) => !(k === 'enabled' && target?.isProduction))
}

export interface FlagSummaryRow {
  key: string
  name: string
  type: FlagType
  environments: {
    environmentId: string
    environmentKey: string
    enabled: boolean
    fallthrough: Serve
    ruleCount: number
    version: number
    updatedAt: Date | string
  }[]
}

export function summaryFor(flag: FlagSummaryRow, environment: Pick<CompareEnvironment, 'id'>) {
  return flag.environments.find((e) => e.environmentId === environment.id)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Whether a cell differs from the baseline cell, judged on what the list summary carries. */
export function cellDiffers(
  flag: FlagSummaryRow,
  environment: CompareEnvironment,
  baseline: CompareEnvironment,
): boolean {
  if (environment.id === baseline.id) return false
  const a = summaryFor(flag, baseline)
  const b = summaryFor(flag, environment)
  if (!a || !b) return Boolean(a) !== Boolean(b)
  return (
    a.enabled !== b.enabled || a.ruleCount !== b.ruleCount || !same(a.fallthrough, b.fallthrough)
  )
}

/** Rule ids are per environment, so comparisons and diffs ignore them. */
export const stripRuleId = (rule: Rule): Omit<Rule, 'id'> => {
  const { id: _id, ...rest } = rule
  return rest
}

export function rulesEqual(a: Rule[], b: Rule[]): boolean {
  return same(a.map(stripRuleId), b.map(stripRuleId))
}

/** "on 10% / off 90%" for a rollout, the variant key for a fixed serve. */
export function describeServe(serve: Serve): string {
  if (serve.type === 'variant') return serve.variant
  const active = serve.variations.filter((v) => v.weight > 0)
  if (active.length === 1 && active[0]) return `${active[0].variant} 100%`
  if (active.length === 0) return 'no traffic'
  return active.map((v) => `${v.variant} ${formatPercent(v.weight)}`).join(' / ')
}

export interface ChangeLine {
  field: CopyField
  text: string
}

/** Human readable list of what copying `fields` from `source` over `target` changes. */
export function describeChanges(
  source: EnvConfig,
  target: EnvConfig,
  fields: CopyField[],
): ChangeLine[] {
  const selected = new Set(fields)
  const lines: ChangeLine[] = []
  if (selected.has('enabled') && source.enabled !== target.enabled) {
    lines.push({
      field: 'enabled',
      text: `Enabled: ${target.enabled ? 'on' : 'off'} → ${source.enabled ? 'on' : 'off'}`,
    })
  }
  if (selected.has('offVariant') && source.offVariant !== target.offVariant) {
    lines.push({
      field: 'offVariant',
      text: `Off variant: ${target.offVariant} → ${source.offVariant}`,
    })
  }
  if (selected.has('fallthrough') && !same(source.fallthrough, target.fallthrough)) {
    lines.push({
      field: 'fallthrough',
      text: `Default: ${describeServe(target.fallthrough)} → ${describeServe(source.fallthrough)}`,
    })
  }
  if (selected.has('rules') && !rulesEqual(source.rules, target.rules)) {
    lines.push({
      field: 'rules',
      text:
        source.rules.length === target.rules.length
          ? `Rules: ${pluralize(source.rules.length, 'rule')} updated`
          : `Rules: ${target.rules.length} → ${source.rules.length}`,
    })
  }
  return lines
}

/** The config as it would look after copying `fields` from `source` over `target`. */
export function applyFields(source: EnvConfig, target: EnvConfig, fields: CopyField[]): EnvConfig {
  const selected = new Set(fields)
  return {
    enabled: selected.has('enabled') ? source.enabled : target.enabled,
    offVariant: selected.has('offVariant') ? source.offVariant : target.offVariant,
    fallthrough: selected.has('fallthrough') ? source.fallthrough : target.fallthrough,
    rules: selected.has('rules') ? source.rules : target.rules,
  }
}

/** JSON suitable for `JsonDiff`: rule ids are dropped as they differ between environments. */
export function diffable(config: EnvConfig): JsonValue {
  return {
    enabled: config.enabled,
    offVariant: config.offVariant,
    fallthrough: config.fallthrough,
    rules: config.rules.map(stripRuleId),
  } as unknown as JsonValue
}

export function variantIndexOf(variants: Variant[], key: string): number {
  return Math.max(
    0,
    variants.findIndex((v) => v.key === key),
  )
}
