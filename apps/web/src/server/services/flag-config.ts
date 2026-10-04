import type {
  FlagEnvironmentConfig,
  FlagType,
  Rule,
  Serve,
  Variant,
} from '@modlogtv/halyard-engine'
import { badRequest } from '@/server/errors'

/** The stored, evaluation-relevant part of a flag in one environment. */
export type StoredEnvironmentConfig = Pick<
  FlagEnvironmentConfig,
  'enabled' | 'offVariant' | 'fallthrough' | 'rules'
>

export const DEFAULT_BOOLEAN_VARIANTS: Variant[] = [
  { key: 'on', value: true, name: 'On' },
  { key: 'off', value: false, name: 'Off' },
]

export function defaultVariantsFor(type: FlagType): Variant[] | undefined {
  return type === 'boolean' ? DEFAULT_BOOLEAN_VARIANTS.map((v) => ({ ...v })) : undefined
}

/**
 * The configuration every flag starts with in a new environment: disabled, serving
 * the off variant, with a fixed-variant fallthrough and no rules.
 *
 * The off variant is the variant whose value is `false` for boolean flags and the last
 * variant otherwise. The fallthrough is the first variant that is not the off variant
 * (or the off variant itself when it is the only one). Callers may override both.
 */
export function defaultEnvironmentConfig(
  flag: { type: FlagType; variants: Variant[] },
  overrides: { offVariant?: string; defaultVariant?: string } = {},
): StoredEnvironmentConfig {
  const variants = flag.variants
  const keys = new Set(variants.map((v) => v.key))
  if (overrides.offVariant !== undefined && !keys.has(overrides.offVariant)) {
    throw badRequest(`Off variant "${overrides.offVariant}" does not exist`)
  }
  if (overrides.defaultVariant !== undefined && !keys.has(overrides.defaultVariant)) {
    throw badRequest(`Default variant "${overrides.defaultVariant}" does not exist`)
  }
  const last = variants[variants.length - 1]
  const offVariant =
    overrides.offVariant ??
    (flag.type === 'boolean' ? variants.find((v) => v.value === false)?.key : undefined) ??
    last?.key
  if (offVariant === undefined) throw badRequest('Flag must have at least one variant')
  const variant =
    overrides.defaultVariant ?? variants.find((v) => v.key !== offVariant)?.key ?? offVariant
  return {
    enabled: false,
    offVariant,
    fallthrough: { type: 'variant', variant },
    rules: [],
  }
}

export function variantKeysInServe(serve: Serve): string[] {
  return serve.type === 'variant' ? [serve.variant] : serve.variations.map((v) => v.variant)
}

export interface VariantReference {
  where: string
}

/** Describes every place in an environment configuration that uses `variantKey`. */
export function findVariantReferences(
  config: StoredEnvironmentConfig,
  variantKey: string,
): VariantReference[] {
  const found: VariantReference[] = []
  if (config.offVariant === variantKey) found.push({ where: 'the off variant' })
  if (variantKeysInServe(config.fallthrough).includes(variantKey))
    found.push({ where: 'the fallthrough' })
  config.rules.forEach((rule, index) => {
    if (variantKeysInServe(rule.serve).includes(variantKey)) {
      found.push({
        where: `rule ${index + 1}${rule.description ? ` ("${rule.description}")` : ''}`,
      })
    }
  })
  return found
}

/** Gives every rule an id; existing ids are kept. */
export function withRuleIds<R extends Omit<Rule, 'id'> & { id?: string }>(rules: R[]): Rule[] {
  return rules.map((rule) => ({ ...rule, id: rule.id ?? crypto.randomUUID() }) as Rule)
}

export function toStoredConfig(row: StoredEnvironmentConfig): StoredEnvironmentConfig {
  return {
    enabled: row.enabled,
    offVariant: row.offVariant,
    fallthrough: row.fallthrough,
    rules: row.rules,
  }
}
