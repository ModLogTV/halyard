import { parseSemver } from './semver.js'
import type {
  AttributeCondition,
  Condition,
  FlagDefinition,
  FlagEnvironmentConfig,
  FlagType,
  RolloutVariation,
  Segment,
  Serve,
} from './types.js'
import { OPERATORS } from './types.js'
import { FLAG_TYPES, valueMatchesType } from './values.js'

/**
 * Pattern for flag, variant, segment and experiment keys: starts with a letter or
 * digit, followed by letters, digits, `.`, `_` or `-`.
 */
export const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Allowed deviation from 100 when summing rollout weights. */
export const WEIGHT_TOLERANCE = 1e-6

const KEY_RULES = 'use letters, digits, ".", "_" and "-", starting with a letter or digit'

/** Whether `key` is a valid flag, variant, segment or experiment key. */
export function isValidKey(key: string): boolean {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const quote = (value: unknown) => (typeof value === 'string' ? `"${value}"` : String(value))

const keyProblem = (label: string, key: unknown): string | undefined => {
  if (typeof key !== 'string' || key === '') return `${label} must not be empty`
  if (!KEY_PATTERN.test(key)) return `${label} "${key}" is invalid: ${KEY_RULES}`
  return undefined
}

const TYPE_EXPECTATIONS: Record<FlagType, string> = {
  boolean: 'a boolean (true or false)',
  string: 'a string',
  number: 'a finite number',
  json: 'valid JSON',
}

/**
 * Validates the project-wide definition of a flag: key format, type, at least one
 * variant, unique non-empty variant keys and variant values matching the flag type.
 * Boolean flags only need boolean values; their variant keys are not prescribed.
 *
 * @returns human readable problems; empty when the flag is valid
 */
export function validateFlagDefinition(flag: FlagDefinition): string[] {
  if (!isObject(flag)) return ['Flag definition must be an object']
  const problems: string[] = []

  const flagKeyProblem = keyProblem('Flag key', flag.key)
  if (flagKeyProblem) problems.push(flagKeyProblem)

  const typeIsKnown = FLAG_TYPES.includes(flag.type)
  if (!typeIsKnown) {
    problems.push(
      `Flag type ${quote(flag.type)} is invalid: expected one of ${FLAG_TYPES.join(', ')}`,
    )
  }

  if (!Array.isArray(flag.variants) || flag.variants.length === 0) {
    problems.push('Flag must have at least one variant')
    return problems
  }

  const seen = new Set<string>()
  flag.variants.forEach((variant, index) => {
    if (!isObject(variant)) {
      problems.push(`Variant ${index + 1} must be an object`)
      return
    }
    const variantKeyProblem = keyProblem(`Variant ${index + 1}: key`, variant.key)
    if (variantKeyProblem) {
      problems.push(variantKeyProblem)
    } else if (seen.has(variant.key)) {
      problems.push(`Variant key "${variant.key}" is used more than once`)
    } else {
      seen.add(variant.key)
    }

    if (typeIsKnown && !valueMatchesType(variant.value, flag.type)) {
      const label = typeof variant.key === 'string' && variant.key ? `"${variant.key}"` : index + 1
      problems.push(
        `Variant ${label}: value must be ${TYPE_EXPECTATIONS[flag.type]} for a ${flag.type} flag`,
      )
    }
  })

  return problems
}

/**
 * Validates rollout variations: at least one variation, each with a variant key
 * (no duplicates) and a finite, non-negative weight; weights must add up to 100
 * within {@link WEIGHT_TOLERANCE}. Variant existence is checked by
 * {@link validateEnvironmentConfig}.
 *
 * @returns human readable problems; empty when the weights are valid
 */
export function validateRolloutWeights(variations: RolloutVariation[]): string[] {
  if (!Array.isArray(variations) || variations.length === 0) {
    return ['Rollout must have at least one variation']
  }

  const problems: string[] = []
  const seen = new Set<string>()
  let sum = 0
  let weightsValid = true

  variations.forEach((variation, index) => {
    if (!isObject(variation)) {
      problems.push(`Variation ${index + 1} must be an object`)
      weightsValid = false
      return
    }
    const label = `Variation ${index + 1}${typeof variation.variant === 'string' && variation.variant ? ` ("${variation.variant}")` : ''}`

    if (typeof variation.variant !== 'string' || variation.variant === '') {
      problems.push(`${label}: variant is required`)
    } else if (seen.has(variation.variant)) {
      problems.push(`Variant "${variation.variant}" appears more than once in the rollout`)
    } else {
      seen.add(variation.variant)
    }

    const { weight } = variation
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      problems.push(`${label}: weight must be a number greater than or equal to 0`)
      weightsValid = false
    } else {
      sum += weight
    }
  })

  if (weightsValid && Math.abs(sum - 100) > WEIGHT_TOLERANCE) {
    problems.push(`Rollout weights must add up to 100 (currently ${Number(sum.toFixed(6))})`)
  }
  return problems
}

const STRING_OPERATORS = new Set(['contains', 'not_contains', 'starts_with', 'ends_with'])
const NUMERIC_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte'])
const NUMERIC_STRING = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/

/**
 * Validates a single rule or segment condition. Segment references are checked
 * against `segmentKeys` when given.
 *
 * @returns human readable problems; empty when the condition is valid
 */
export function validateCondition(
  condition: Condition,
  segmentKeys?: Set<string> | string[],
): string[] {
  if (!isObject(condition)) return ['Condition must be an object']

  if (condition.type === 'segment') {
    const key = condition.segmentKey
    if (typeof key !== 'string' || key === '') return ['Segment key is required']
    if (segmentKeys && !toSet(segmentKeys).has(key)) return [`segment "${key}" does not exist`]
    if (condition.negate !== undefined && typeof condition.negate !== 'boolean') {
      return ['negate must be a boolean']
    }
    return []
  }
  if (condition.type !== 'attribute') {
    return [
      `Condition type ${quote((condition as { type?: unknown }).type)} is invalid: expected "attribute" or "segment"`,
    ]
  }
  return validateAttributeCondition(condition)
}

function validateAttributeCondition(condition: AttributeCondition): string[] {
  const problems: string[] = []
  const { attribute, operator, value } = condition

  if (typeof attribute !== 'string' || attribute === '') problems.push('attribute is required')
  if (!OPERATORS.includes(operator)) {
    problems.push(`operator ${quote(operator)} is invalid: expected one of ${OPERATORS.join(', ')}`)
    return problems
  }

  const op = `operator "${operator}"`
  if (operator === 'exists' || operator === 'not_exists') return problems

  if (operator === 'eq' || operator === 'neq') {
    if (value === undefined || value === null) problems.push(`${op} requires a value`)
  } else if (operator === 'in' || operator === 'not_in') {
    if (!Array.isArray(value)) problems.push(`${op} requires an array of values`)
  } else if (STRING_OPERATORS.has(operator)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      problems.push(`${op} requires a string value`)
    }
  } else if (NUMERIC_OPERATORS.has(operator)) {
    const numeric =
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && NUMERIC_STRING.test(value))
    if (!numeric) problems.push(`${op} requires a number value`)
  } else if (operator === 'regex') {
    if (typeof value !== 'string' || !compiles(value)) {
      problems.push(`${op} requires a valid regular expression`)
    }
  } else if (typeof value !== 'string' || !parseSemver(value)) {
    // semver_* operators
    problems.push(`${op} requires a valid semantic version such as "1.2.3"`)
  }
  return problems
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

function toSet(keys: Set<string> | string[]): Set<string> {
  return keys instanceof Set ? keys : new Set(Array.isArray(keys) ? keys : [])
}

/**
 * Validates the per-environment configuration of a flag: `enabled` is a boolean;
 * the off variant, rule variants, fallthrough variants and experiment variants
 * exist; rollout weights are valid; rules have unique non-empty ids; conditions
 * are well formed and referenced segments exist in `segmentKeys`.
 *
 * @returns human readable problems; empty when the config is valid
 */
export function validateEnvironmentConfig(
  flag: FlagDefinition,
  config: FlagEnvironmentConfig,
  segmentKeys: Set<string> | string[],
): string[] {
  if (!isObject(config)) return ['Environment configuration must be an object']

  const problems: string[] = []
  const variantKeys = new Set(
    isObject(flag) && Array.isArray(flag.variants)
      ? flag.variants.filter(isObject).map((variant) => variant.key)
      : [],
  )
  const segments = toSet(segmentKeys)

  if (typeof config.enabled !== 'boolean') problems.push('enabled must be true or false')
  if (!variantKeys.has(config.offVariant)) {
    problems.push(`Off variant ${quote(config.offVariant)} does not exist`)
  }

  if (!Array.isArray(config.rules)) {
    problems.push('Rules must be an array')
  } else {
    const ruleIds = new Set<string>()
    config.rules.forEach((rule, index) => {
      if (!isObject(rule)) {
        problems.push(`Rule ${index + 1} must be an object`)
        return
      }
      const hasId = typeof rule.id === 'string' && rule.id !== ''
      const label = `Rule ${index + 1}${hasId ? ` ("${rule.id}")` : ''}`
      if (!hasId) {
        problems.push(`${label}: id is required`)
      } else if (ruleIds.has(rule.id)) {
        problems.push(`Rule id "${rule.id}" is used more than once`)
      } else {
        ruleIds.add(rule.id)
      }

      if (!Array.isArray(rule.conditions)) {
        problems.push(`${label}: conditions must be an array`)
      } else {
        rule.conditions.forEach((condition, conditionIndex) => {
          for (const problem of validateCondition(condition, segments)) {
            problems.push(`${label}, condition ${conditionIndex + 1}: ${problem}`)
          }
        })
      }
      problems.push(...validateServe(rule.serve, variantKeys).map((p) => `${label}: ${p}`))
    })
  }

  problems.push(...validateServe(config.fallthrough, variantKeys).map((p) => `Fallthrough: ${p}`))

  const { experiment } = config
  if (experiment !== undefined && experiment !== null) {
    if (!isObject(experiment)) {
      problems.push('Experiment must be an object')
    } else {
      const experimentKeyProblem = keyProblem('Experiment key', experiment.key)
      if (experimentKeyProblem) problems.push(experimentKeyProblem)
      const label = `Experiment ${quote(experiment.key)}`
      problems.push(
        ...validateVariations(experiment.variations, experiment.bucketBy, variantKeys).map(
          (p) => `${label}: ${p}`,
        ),
      )
    }
  }

  return problems
}

function validateServe(serve: Serve, variantKeys: Set<string>): string[] {
  if (!isObject(serve)) return ['serve is required']
  if (serve.type === 'variant') {
    return variantKeys.has(serve.variant) ? [] : [`variant ${quote(serve.variant)} does not exist`]
  }
  if (serve.type === 'rollout') {
    return validateVariations(serve.variations, serve.bucketBy, variantKeys)
  }
  return [
    `serve type ${quote((serve as { type?: unknown }).type)} is invalid: expected "variant" or "rollout"`,
  ]
}

function validateVariations(
  variations: RolloutVariation[],
  bucketBy: unknown,
  variantKeys: Set<string>,
): string[] {
  const problems: string[] = []
  if (Array.isArray(variations)) {
    for (const variation of variations) {
      if (
        isObject(variation) &&
        typeof variation.variant === 'string' &&
        variation.variant !== ''
      ) {
        if (!variantKeys.has(variation.variant)) {
          problems.push(`rollout variant "${variation.variant}" does not exist`)
        }
      }
    }
  }
  problems.push(...validateRolloutWeights(variations))
  if (bucketBy !== undefined && (typeof bucketBy !== 'string' || bucketBy === '')) {
    problems.push('bucketBy must be a non-empty attribute name when set')
  }
  return problems
}

/**
 * Validates a segment: key format, `match` mode and attribute conditions.
 * Segments cannot reference other segments.
 *
 * @returns human readable problems; empty when the segment is valid
 */
export function validateSegment(segment: Segment): string[] {
  if (!isObject(segment)) return ['Segment must be an object']
  const problems: string[] = []

  const segmentKeyProblem = keyProblem('Segment key', segment.key)
  if (segmentKeyProblem) problems.push(segmentKeyProblem)

  if (segment.match !== undefined && segment.match !== 'all' && segment.match !== 'any') {
    problems.push(`match ${quote(segment.match)} is invalid: expected "all" or "any"`)
  }

  if (!Array.isArray(segment.conditions)) {
    problems.push('Segment conditions must be an array')
    return problems
  }
  segment.conditions.forEach((condition, index) => {
    const label = `Condition ${index + 1}`
    if (isObject(condition) && (condition as { type?: unknown }).type === 'segment') {
      problems.push(`${label}: segments cannot reference other segments`)
      return
    }
    for (const problem of validateCondition(condition)) problems.push(`${label}: ${problem}`)
  })
  return problems
}
