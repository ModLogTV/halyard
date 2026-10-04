import { bucketFor, pickVariation } from './bucket.js'
import { getAttribute, matchRule } from './conditions.js'
import type {
  ErrorCode,
  EvaluationContext,
  EvaluationDetails,
  EvaluationInput,
  FlagDefinition,
  FlagEnvironmentConfig,
  JsonValue,
  ResolutionReason,
  RolloutVariation,
  Ruleset,
  Segment,
  Serve,
  Variant,
} from './types.js'
import { FLAG_TYPES, valueMatchesType } from './values.js'

/** Internal control flow for evaluation failures; never escapes {@link evaluateFlag}. */
class EvaluationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
  }
}

const general = (message: string) => new EvaluationError('GENERAL', message)

type Extra = Pick<
  EvaluationDetails,
  'ruleId' | 'ruleIndex' | 'matchedSegments' | 'bucket' | 'experimentKey'
>

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Evaluates one flag for one context.
 *
 * 1. The flag and config are checked: the flag needs variants, a known type, and
 *    the off variant plus every variant referenced by rules, the fallthrough and
 *    the experiment must exist. Otherwise → `ERROR` / `GENERAL`.
 * 2. Disabled → off variant, `DISABLED`.
 * 3. Rules in order, the first match wins → `TARGETING_MATCH` (variant) or `SPLIT` (rollout).
 * 4. No rule matched: experiment allocation (`SPLIT` + `experimentKey`) if present,
 *    otherwise the fallthrough → `STATIC` (variant) or `SPLIT` (rollout).
 *
 * Rollouts bucket on `context[bucketBy ?? 'targetingKey']`, salted with the flag key
 * (rules and fallthrough) or `${flagKey}.${experimentKey}` (experiments). A missing
 * bucketing value → `ERROR` / `TARGETING_KEY_MISSING`. A served value that does not
 * match the flag type → `ERROR` / `TYPE_MISMATCH`.
 *
 * On `ERROR` the value is the off variant's value when it exists and matches the
 * flag type, `null` otherwise. This function never throws.
 */
export function evaluateFlag(input: EvaluationInput): EvaluationDetails {
  const flagKey =
    isObject(input) && isObject(input.flag) && typeof input.flag.key === 'string'
      ? input.flag.key
      : ''
  let fallbackValue: JsonValue = null

  try {
    if (!isObject(input)) throw general('Evaluation input must be an object')
    const { flag, config } = input
    const variants = indexVariants(flag)
    if (!isObject(config)) throw general(`Flag "${flagKey}" has no environment configuration`)

    const offVariant = variants.get(config.offVariant)
    if (!offVariant) {
      throw general(
        `Off variant "${String(config.offVariant)}" does not exist in flag "${flagKey}"`,
      )
    }
    if (valueMatchesType(offVariant.value, flag.type)) fallbackValue = offVariant.value
    checkVariantReferences(flagKey, config, variants)

    const context: EvaluationContext = isObject(input.context) ? input.context : {}
    const segments: Record<string, Segment> = isObject(input.segments) ? input.segments : {}

    const resolve = (variant: Variant, reason: ResolutionReason, extra: Extra = {}) => {
      if (!valueMatchesType(variant.value, flag.type)) {
        throw new EvaluationError(
          'TYPE_MISMATCH',
          `Variant "${variant.key}" of flag "${flagKey}" has a ${describeType(variant.value)} value, expected ${flag.type}`,
        )
      }
      const details: EvaluationDetails = {
        flagKey,
        value: variant.value,
        variant: variant.key,
        reason,
      }
      return Object.assign(details, extra)
    }

    const rollout = (
      variations: RolloutVariation[],
      bucketBy: string | undefined,
      salt: string,
      label: string,
      extra: Extra,
    ) => {
      const bucket = bucketFor(salt, bucketValue(context, bucketBy))
      const picked = pickVariation(variations, bucket)
      if (!picked) {
        throw general(
          `${label} of flag "${flagKey}" does not cover bucket ${bucket / 1000}: rollout weights must add up to 100`,
        )
      }
      return resolve(variants.get(picked.variant)!, 'SPLIT', { ...extra, bucket: bucket / 1000 })
    }

    const serve = (target: Serve, reason: ResolutionReason, label: string, extra: Extra) =>
      target.type === 'variant'
        ? resolve(variants.get(target.variant)!, reason, extra)
        : rollout(target.variations, target.bucketBy, flag.key, label, extra)

    if (!config.enabled) return resolve(offVariant, 'DISABLED')

    for (const [ruleIndex, rule] of config.rules.entries()) {
      const { matched, matchedSegments } = matchRule(rule, context, segments)
      if (matched) {
        return serve(rule.serve, 'TARGETING_MATCH', `Rollout of rule "${rule.id}"`, {
          ruleId: rule.id,
          ruleIndex,
          matchedSegments,
        })
      }
    }

    const { experiment } = config
    if (experiment) {
      return rollout(
        experiment.variations,
        experiment.bucketBy,
        `${flag.key}.${experiment.key}`,
        `Experiment "${experiment.key}"`,
        { experimentKey: experiment.key },
      )
    }

    return serve(config.fallthrough, 'STATIC', 'Fallthrough rollout', {})
  } catch (error) {
    if (error instanceof EvaluationError) {
      return errorDetails(flagKey, fallbackValue, error.code, error.message)
    }
    const message = error instanceof Error ? error.message : String(error)
    return errorDetails(
      flagKey,
      fallbackValue,
      'GENERAL',
      `Unexpected evaluation error: ${message}`,
    )
  }
}

function errorDetails(
  flagKey: string,
  value: JsonValue,
  errorCode: ErrorCode,
  errorMessage: string,
): EvaluationDetails {
  return { flagKey, value, reason: 'ERROR', errorCode, errorMessage }
}

/** Validates the flag's shape and indexes its variants by key. */
function indexVariants(flag: FlagDefinition): Map<string, Variant> {
  if (!isObject(flag)) throw general('Flag definition is missing')
  if (!FLAG_TYPES.includes(flag.type)) {
    throw general(`Flag "${flag.key}" has unknown type "${String(flag.type)}"`)
  }
  if (!Array.isArray(flag.variants) || flag.variants.length === 0) {
    throw general(`Flag "${flag.key}" has no variants`)
  }

  const variants = new Map<string, Variant>()
  for (const variant of flag.variants) {
    if (!isObject(variant) || typeof variant.key !== 'string') {
      throw general(`Flag "${flag.key}" has a malformed variant`)
    }
    if (variants.has(variant.key)) {
      throw general(`Flag "${flag.key}" has duplicate variant key "${variant.key}"`)
    }
    variants.set(variant.key, variant)
  }
  return variants
}

/**
 * Ensures every variant referenced by the config exists, so that a broken config
 * fails for every context instead of only for the contexts that hit the broken path.
 */
function checkVariantReferences(
  flagKey: string,
  config: FlagEnvironmentConfig,
  variants: Map<string, Variant>,
): void {
  const checkVariations = (variations: unknown, label: string) => {
    if (!Array.isArray(variations)) throw general(`${label} of flag "${flagKey}" has no variations`)
    for (const variation of variations) {
      if (!isObject(variation))
        throw general(`${label} of flag "${flagKey}" has a malformed variation`)
      if (typeof variation.variant !== 'string' || !variants.has(variation.variant)) {
        throw general(
          `${label} of flag "${flagKey}" references unknown variant "${String(variation.variant)}"`,
        )
      }
    }
  }

  const checkServe = (serve: unknown, label: string) => {
    if (!isObject(serve)) throw general(`${label} of flag "${flagKey}" is missing`)
    if (serve.type === 'variant') {
      if (typeof serve.variant !== 'string' || !variants.has(serve.variant)) {
        throw general(
          `${label} of flag "${flagKey}" serves unknown variant "${String(serve.variant)}"`,
        )
      }
    } else if (serve.type === 'rollout') {
      checkVariations(serve.variations, `${label} rollout`)
    } else {
      throw general(`${label} of flag "${flagKey}" has unknown serve type "${String(serve.type)}"`)
    }
  }

  if (!Array.isArray(config.rules)) throw general(`Rules of flag "${flagKey}" must be an array`)
  config.rules.forEach((rule, index) => {
    if (!isObject(rule)) throw general(`Rule ${index} of flag "${flagKey}" is malformed`)
    checkServe(rule.serve, `Rule "${rule.id}"`)
  })
  checkServe(config.fallthrough, 'Fallthrough')

  if (config.experiment !== undefined && config.experiment !== null) {
    if (!isObject(config.experiment) || typeof config.experiment.key !== 'string') {
      throw general(`Experiment of flag "${flagKey}" is malformed`)
    }
    checkVariations(config.experiment.variations, `Experiment "${config.experiment.key}"`)
  }
}

/** Resolves the string a context is bucketed by; throws `TARGETING_KEY_MISSING` when absent. */
function bucketValue(context: EvaluationContext, bucketBy: string | undefined): string {
  const attribute = typeof bucketBy === 'string' && bucketBy !== '' ? bucketBy : 'targetingKey'
  const value = getAttribute(context, attribute)
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  throw new EvaluationError(
    'TARGETING_KEY_MISSING',
    `Context attribute "${attribute}" is required for percentage rollouts but is missing, empty or not a string, number or boolean`,
  )
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Evaluates every flag of a ruleset for one context. The result is keyed like
 * `ruleset.flags`. A malformed entry yields an `ERROR` entry and never affects other flags.
 */
export function evaluateRuleset(
  ruleset: Ruleset,
  context: EvaluationContext,
): Record<string, EvaluationDetails> {
  if (!isObject(ruleset) || !isObject(ruleset.flags)) return {}
  const segments = isObject(ruleset.segments) ? ruleset.segments : {}
  // Object.fromEntries defines own properties, so even a `__proto__` key is safe.
  return Object.fromEntries(
    Object.entries(ruleset.flags).map(([key, entry]) => {
      const details = evaluateFlag({
        flag: entry?.flag,
        config: entry?.config,
        segments,
        context,
      } as EvaluationInput)
      return [key, details.flagKey ? details : { ...details, flagKey: key }]
    }),
  )
}

/** Evaluates flags of one ruleset (one project environment). */
export interface Evaluator {
  /** Evaluates one flag. Unknown flags resolve to `ERROR` / `FLAG_NOT_FOUND` with value `null`. */
  evaluate(flagKey: string, context: EvaluationContext): EvaluationDetails
  /** Evaluates all flags of the ruleset, see {@link evaluateRuleset}. */
  evaluateAll(context: EvaluationContext): Record<string, EvaluationDetails>
}

/** Creates an {@link Evaluator} bound to a ruleset snapshot. Never throws. */
export function createEvaluator(ruleset: Ruleset): Evaluator {
  const flags = isObject(ruleset) && isObject(ruleset.flags) ? ruleset.flags : {}
  const segments = isObject(ruleset) && isObject(ruleset.segments) ? ruleset.segments : {}

  return {
    evaluate(flagKey, context) {
      const entry = Object.hasOwn(flags, flagKey) ? flags[flagKey] : undefined
      if (!entry) {
        const where = isObject(ruleset)
          ? ` in environment "${ruleset.environmentKey}" of project "${ruleset.projectKey}"`
          : ''
        return errorDetails(
          flagKey,
          null,
          'FLAG_NOT_FOUND',
          `Flag "${flagKey}" was not found${where}`,
        )
      }
      const details = evaluateFlag({ flag: entry.flag, config: entry.config, segments, context })
      return details.flagKey ? details : { ...details, flagKey }
    },
    evaluateAll(context) {
      return evaluateRuleset(ruleset, context)
    },
  }
}
