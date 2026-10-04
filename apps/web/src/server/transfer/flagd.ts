import type {
  AttributeCondition,
  Condition,
  JsonValue,
  Rule,
  Serve,
} from '@modlogtv/halyard-engine'
import { badRequest } from '@/server/errors'
import type { ExportDocument, ExportFlag, ExportSegment } from './format'

/**
 * Converts an environment of a Halyard export document to a flagd flag definition file, see
 * https://flagd.dev/reference/flag-definitions/ and
 * https://github.com/open-feature/flagd-schemas. Targeting is JsonLogic with flagd's custom
 * operators (`fractional`, `starts_with`, `ends_with`, `sem_ver`) and `$evaluators`.
 *
 * Whatever flagd cannot express exactly is reported in `warnings`; nothing is dropped silently.
 */

export const FLAGD_SCHEMA_URL = 'https://flagd.dev/schema/v0/flags.json'

export type FlagdMetadata = Record<string, string | number | boolean>

export interface FlagdFlag {
  state: 'ENABLED' | 'DISABLED'
  variants: Record<string, JsonValue>
  defaultVariant: string | null
  targeting?: JsonValue
  metadata?: FlagdMetadata
}

export interface FlagdDocument {
  $schema: string
  flags: Record<string, FlagdFlag>
  $evaluators?: Record<string, JsonValue>
  metadata?: FlagdMetadata
}

export interface FlagdExport {
  flagd: FlagdDocument
  warnings: string[]
}

type Translation = { logic: JsonValue } | { unsupported: string }

const ALWAYS: JsonValue = { '==': [1, 1] }
const NEVER: JsonValue = { '==': [0, 1] }

/** Semantic versions as accepted by the flagd schema (no leading `v`). */
const FLAGD_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const SEMVER_OPERATORS: Record<string, string> = {
  semver_eq: '=',
  semver_gt: '>',
  semver_gte: '>=',
  semver_lt: '<',
  semver_lte: '<=',
}

const NUMERIC_OPERATORS: Record<string, string> = { gt: '>', gte: '>=', lt: '<', lte: '<=' }

const asText = (value: JsonValue | undefined): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? null)

function attributeLogic(condition: AttributeCondition): Translation {
  const subject: JsonValue = { var: condition.attribute }
  const { operator, value } = condition
  switch (operator) {
    case 'eq':
      return { logic: { '==': [subject, value ?? null] } }
    case 'neq':
      return { logic: { '!=': [subject, value ?? null] } }
    case 'in':
      return { logic: { in: [subject, Array.isArray(value) ? value : [value ?? null]] } }
    case 'not_in':
      return {
        logic: { '!': [{ in: [subject, Array.isArray(value) ? value : [value ?? null]] }] },
      }
    case 'contains':
      return { logic: { in: [value ?? null, subject] } }
    case 'not_contains':
      return { logic: { '!': [{ in: [value ?? null, subject] }] } }
    case 'starts_with':
      return { logic: { starts_with: [subject, asText(value)] } }
    case 'ends_with':
      return { logic: { ends_with: [subject, asText(value)] } }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { logic: { [NUMERIC_OPERATORS[operator] as string]: [subject, Number(value)] } }
    case 'exists':
      return { logic: { '!!': [subject] } }
    case 'not_exists':
      return { logic: { '!': [subject] } }
    case 'regex':
      return {
        unsupported: `the "regex" operator on "${condition.attribute}" has no flagd equivalent`,
      }
    default: {
      const comparison = SEMVER_OPERATORS[operator]
      const version = typeof value === 'string' ? value.trim().replace(/^v/, '') : ''
      if (!comparison || !FLAGD_SEMVER.test(version)) {
        return {
          unsupported: `"${operator}" on "${condition.attribute}" needs a version like 1.2.3 to be expressed in flagd`,
        }
      }
      return { logic: { sem_ver: [subject, comparison, version] } }
    }
  }
}

function combine(op: 'and' | 'or', parts: JsonValue[]): JsonValue {
  return parts.length === 1 ? (parts[0] as JsonValue) : { [op]: parts }
}

/** Relative integer weights; decimal percentages are scaled up (flagd weights are integers). */
function integerWeights(weights: number[]): number[] {
  let decimals = 0
  for (const weight of weights) {
    for (let d = 0; d <= 6; d += 1) {
      decimals = Math.max(decimals, d)
      if (Math.abs(weight * 10 ** d - Math.round(weight * 10 ** d)) < 1e-9) break
    }
  }
  const factor = 10 ** decimals
  return weights.map((w) => Math.round(w * factor))
}

function fractionalLogic(serve: Extract<Serve, { type: 'rollout' }>): JsonValue {
  const weights = integerWeights(serve.variations.map((v) => v.weight))
  return {
    fractional: [
      { cat: [{ var: '$flagd.flagKey' }, { var: serve.bucketBy ?? 'targetingKey' }] },
      ...serve.variations.map((variation, index) => [variation.variant, weights[index] as number]),
    ],
  }
}

function segmentEvaluator(segment: ExportSegment): Translation {
  const parts: JsonValue[] = []
  for (const condition of segment.conditions) {
    const translated = attributeLogic(condition)
    if ('unsupported' in translated) return translated
    parts.push(translated.logic)
  }
  if (parts.length === 0) return { logic: segment.match === 'any' ? NEVER : ALWAYS }
  return { logic: combine(segment.match === 'any' ? 'or' : 'and', parts) }
}

const labelRule = (flagKey: string, rule: Rule, index: number) =>
  `Flag "${flagKey}" rule ${index + 1}${rule.description ? ` ("${rule.description}")` : ''}`

/**
 * Builds the flagd definition of one environment. Throws a 400 for an unknown environment.
 */
export function exportFlagd(input: {
  document: ExportDocument
  environmentKey: string
}): FlagdExport {
  const { document, environmentKey } = input
  if (!document.environments.some((env) => env.key === environmentKey)) {
    throw badRequest(`Unknown environment "${environmentKey}"`)
  }
  const warnings: string[] = []

  // Segments become shared evaluators.
  const evaluators: Record<string, JsonValue> = {}
  const unsupportedSegments = new Map<string, string>()
  for (const segment of document.segments) {
    const translated = segmentEvaluator(segment)
    if ('unsupported' in translated) {
      unsupportedSegments.set(segment.key, translated.unsupported)
      warnings.push(
        `Segment "${segment.key}" is skipped: ${translated.unsupported}. Rules that use it are skipped as well`,
      )
    } else {
      evaluators[segment.key] = translated.logic
    }
  }

  const exported: Record<string, FlagdFlag> = {}
  for (const flag of document.flags) {
    const result = exportFlag(flag, environmentKey, unsupportedSegments, warnings)
    if (result) exported[flag.key] = result
  }

  const flagd: FlagdDocument = {
    $schema: FLAGD_SCHEMA_URL,
    flags: exported,
    ...(Object.keys(evaluators).length > 0 && { $evaluators: evaluators }),
    metadata: { source: 'halyard', project: document.project.slug, environment: environmentKey },
  }
  return { flagd, warnings }
}

function exportFlag(
  flag: ExportFlag,
  environmentKey: string,
  unsupportedSegments: Map<string, string>,
  warnings: string[],
): FlagdFlag | undefined {
  const quoted = `Flag "${flag.key}"`
  if (flag.archived) {
    warnings.push(`${quoted} is archived and is not exported`)
    return undefined
  }
  const config = flag.environments[environmentKey]
  if (!config) {
    warnings.push(
      `${quoted} has no configuration for environment "${environmentKey}" and is skipped`,
    )
    return undefined
  }
  if (flag.type === 'json') {
    const bad = flag.variants.find(
      (v) => typeof v.value !== 'object' || v.value === null || Array.isArray(v.value),
    )
    if (bad) {
      warnings.push(
        `${quoted} is skipped: variant "${bad.key}" is not a JSON object, and flagd object flags only support objects`,
      )
      return undefined
    }
  }

  const variants: Record<string, JsonValue> = {}
  for (const variant of flag.variants) variants[variant.key] = variant.value

  if (!config.enabled) {
    warnings.push(
      `${quoted} is disabled in "${environmentKey}": flagd serves the code default for disabled flags, so the off variant "${config.offVariant}" is lost`,
    )
  }

  // Rules become an if/else-if chain evaluated in order.
  const branches: JsonValue[] = []
  let otherwise: JsonValue | undefined
  const serveLogic = (serve: Serve, where: string): JsonValue => {
    if (serve.type === 'variant') return serve.variant
    warnings.push(
      `${where} serves a percentage rollout, which is exported as flagd's "fractional" operator; flagd buckets users with a different hash than Halyard, so the same user can get a different variant`,
    )
    return fractionalLogic(serve)
  }

  for (const [index, rule] of config.rules.entries()) {
    const where = labelRule(flag.key, rule, index)
    const parts: JsonValue[] = []
    const notes: string[] = []
    let skipped: string | undefined
    for (const condition of rule.conditions as Condition[]) {
      if (condition.type === 'segment') {
        const reason = unsupportedSegments.get(condition.segmentKey)
        if (reason !== undefined) {
          skipped = `segment "${condition.segmentKey}" cannot be expressed in flagd`
          break
        }
        const ref: JsonValue = { $ref: condition.segmentKey }
        parts.push(condition.negate ? { '!': [ref] } : ref)
        continue
      }
      const translated = attributeLogic(condition)
      if ('unsupported' in translated) {
        skipped = translated.unsupported
        break
      }
      if (condition.operator === 'exists' || condition.operator === 'not_exists') {
        notes.push(
          `${where}: "${condition.operator}" on "${condition.attribute}" is exported as a JsonLogic truthiness test, so empty strings, 0 and false count as missing`,
        )
      }
      parts.push(translated.logic)
    }
    if (skipped) {
      warnings.push(`${where} is skipped: ${skipped}`)
      continue
    }
    warnings.push(...notes)
    const result = serveLogic(rule.serve, where)
    if (parts.length === 0) {
      // Matches everyone; later rules and the fallthrough can never be reached.
      otherwise = result
      break
    }
    branches.push(combine('and', parts), result)
  }

  let defaultVariant: string
  if (config.fallthrough.type === 'variant') {
    defaultVariant = config.fallthrough.variant
  } else {
    defaultVariant = config.offVariant
    if (otherwise === undefined) {
      otherwise = serveLogic(config.fallthrough, `${quoted} fallthrough`)
    }
  }

  let targeting: JsonValue | undefined
  if (branches.length > 0) {
    targeting = { if: otherwise === undefined ? branches : [...branches, otherwise] }
  } else if (typeof otherwise === 'string') {
    defaultVariant = otherwise
  } else if (otherwise !== undefined) {
    targeting = otherwise
  }

  const metadata: FlagdMetadata = {}
  if (flag.description) metadata.description = flag.description
  if (flag.tags.length > 0) metadata.tags = flag.tags.join(',')

  return {
    state: config.enabled ? 'ENABLED' : 'DISABLED',
    variants,
    defaultVariant,
    ...(targeting !== undefined && { targeting }),
    ...(Object.keys(metadata).length > 0 && { metadata }),
  }
}
