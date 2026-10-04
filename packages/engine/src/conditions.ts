import { compareSemver } from './semver.js'
import type {
  AttributeCondition,
  Condition,
  EvaluationContext,
  JsonValue,
  Operator,
  Rule,
  Segment,
} from './types.js'

/** Result of matching a rule against a context. */
export interface RuleMatch {
  matched: boolean
  /** Segments the context is a member of that contributed to the match (non-negated conditions). */
  matchedSegments: string[]
}

const hasOwn = (target: object, key: string): boolean => Object.hasOwn(target, key)

/**
 * Reads an attribute from the evaluation context.
 *
 * - A literal top-level key wins, so `{ 'app.version': '1.0.0' }` is addressable as `app.version`.
 * - Otherwise `a.b.c` walks nested objects; numeric segments index into arrays (`tags.0`).
 * - Only own properties are visible (no `constructor`, `__proto__`, `length`, ...).
 *
 * Returns `undefined` when the path does not resolve. `null` is returned as is;
 * condition matching treats it like a missing attribute.
 */
export function getAttribute(context: EvaluationContext, path: string): JsonValue | undefined {
  if (!isObject(context) || typeof path !== 'string' || path === '') return undefined
  if (hasOwn(context, path)) return context[path]
  if (!path.includes('.')) return undefined

  let current: JsonValue | undefined = context as { [key: string]: JsonValue }
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined
      current = current[Number(segment)]
    } else if (isObject(current)) {
      current = hasOwn(current, segment) ? current[segment] : undefined
    } else {
      return undefined
    }
    if (current === undefined) return undefined
  }
  return current
}

/**
 * Evaluates one attribute condition against a context. Never throws; malformed
 * conditions simply do not match.
 *
 * Semantics:
 * - A missing attribute (absent or `null`) only satisfies `not_exists`, `neq`,
 *   `not_in` and `not_contains`.
 * - `eq` / `neq` / `in` / `not_in`: strings compare exactly; numbers compare
 *   numerically and accept numeric strings on either side; booleans compare with
 *   booleans and the strings `"true"` / `"false"`; arrays and objects compare
 *   structurally. `in` with an array attribute matches when any element is in the list.
 *   A non-array `in` value is treated as a single-element list.
 * - `contains` / `starts_with` / `ends_with`: string operations; numbers and
 *   booleans are coerced to strings. `contains` on an array attribute tests membership.
 * - `gt` / `gte` / `lt` / `lte`: numeric; accept finite numbers and decimal numeric strings.
 * - `regex`: unanchored `RegExp` test; invalid patterns never match.
 * - `semver_*`: semantic version precedence; invalid versions never match.
 */
export function matchAttributeCondition(
  condition: AttributeCondition,
  context: EvaluationContext,
): boolean {
  try {
    if (!isObject(condition)) return false
    return evaluateOperator(
      condition.operator,
      getAttribute(context, condition.attribute),
      condition.value,
    )
  } catch {
    return false
  }
}

function evaluateOperator(
  operator: Operator,
  rawAttribute: JsonValue | undefined,
  value: JsonValue | undefined,
): boolean {
  const attribute = rawAttribute ?? undefined
  if (attribute === undefined) {
    return (
      operator === 'not_exists' ||
      operator === 'neq' ||
      operator === 'not_in' ||
      operator === 'not_contains'
    )
  }

  switch (operator) {
    case 'exists':
      return true
    case 'not_exists':
      return false
    case 'eq':
      return looselyEqual(attribute, value)
    case 'neq':
      return !looselyEqual(attribute, value)
    case 'in':
      return isIn(attribute, value)
    case 'not_in':
      return !isIn(attribute, value)
    case 'contains':
      return contains(attribute, value)
    case 'not_contains':
      return !contains(attribute, value)
    case 'starts_with':
      return stringTest(attribute, value, (a, v) => a.startsWith(v))
    case 'ends_with':
      return stringTest(attribute, value, (a, v) => a.endsWith(v))
    case 'gt':
      return numericTest(attribute, value, (a, v) => a > v)
    case 'gte':
      return numericTest(attribute, value, (a, v) => a >= v)
    case 'lt':
      return numericTest(attribute, value, (a, v) => a < v)
    case 'lte':
      return numericTest(attribute, value, (a, v) => a <= v)
    case 'regex':
      return regexTest(attribute, value)
    case 'semver_eq':
      return semverTest(attribute, value, (c) => c === 0)
    case 'semver_gt':
      return semverTest(attribute, value, (c) => c > 0)
    case 'semver_gte':
      return semverTest(attribute, value, (c) => c >= 0)
    case 'semver_lt':
      return semverTest(attribute, value, (c) => c < 0)
    case 'semver_lte':
      return semverTest(attribute, value, (c) => c <= 0)
    default:
      return false
  }
}

/** Equality with the coercions documented on {@link matchAttributeCondition}. */
function looselyEqual(a: JsonValue, b: JsonValue | undefined): boolean {
  if (b === undefined || b === null) return false
  if (typeof a === 'string' && typeof b === 'string') return a === b
  if (typeof a === 'number' || typeof b === 'number') {
    const x = toNumber(a)
    const y = toNumber(b)
    return x !== undefined && y !== undefined && x === y
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const x = toBoolean(a)
    const y = toBoolean(b)
    return x !== undefined && y !== undefined && x === y
  }
  return deepEqual(a, b)
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]!))
  }
  if (isObject(a) && isObject(b) && !Array.isArray(b)) {
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((key) => hasOwn(b, key) && deepEqual(a[key]!, b[key]!))
  }
  return false
}

function isIn(attribute: JsonValue, value: JsonValue | undefined): boolean {
  if (value === undefined) return false
  const list = Array.isArray(value) ? value : [value]
  const candidates = Array.isArray(attribute) ? attribute : [attribute]
  return candidates.some((candidate) => list.some((item) => looselyEqual(candidate, item)))
}

function contains(attribute: JsonValue, value: JsonValue | undefined): boolean {
  if (Array.isArray(attribute)) {
    return attribute.some((item) => item !== null && looselyEqual(item, value))
  }
  return stringTest(attribute, value, (a, v) => a.includes(v))
}

function stringTest(
  attribute: JsonValue,
  value: JsonValue | undefined,
  test: (attribute: string, value: string) => boolean,
): boolean {
  const a = toStringValue(attribute)
  const v = toStringValue(value)
  return a !== undefined && v !== undefined && test(a, v)
}

function numericTest(
  attribute: JsonValue,
  value: JsonValue | undefined,
  test: (attribute: number, value: number) => boolean,
): boolean {
  const a = toNumber(attribute)
  const v = toNumber(value)
  return a !== undefined && v !== undefined && test(a, v)
}

function semverTest(
  attribute: JsonValue,
  value: JsonValue | undefined,
  test: (comparison: number) => boolean,
): boolean {
  if (typeof attribute !== 'string' || typeof value !== 'string') return false
  const comparison = compareSemver(attribute, value)
  return comparison !== undefined && test(comparison)
}

const REGEX_CACHE_LIMIT = 256
const regexCache = new Map<string, RegExp | null>()

function compileRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern)
  if (cached !== undefined) return cached
  let compiled: RegExp | null
  try {
    compiled = new RegExp(pattern)
  } catch {
    compiled = null
  }
  if (regexCache.size >= REGEX_CACHE_LIMIT) regexCache.clear()
  regexCache.set(pattern, compiled)
  return compiled
}

function regexTest(attribute: JsonValue, value: JsonValue | undefined): boolean {
  if (typeof value !== 'string') return false
  const subject = toStringValue(attribute)
  if (subject === undefined) return false
  // Patterns are compiled without flags, so `test` is stateless (no `lastIndex`).
  return compileRegex(value)?.test(subject) ?? false
}

const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** Finite numbers and decimal numeric strings (surrounding whitespace allowed). */
function toNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!DECIMAL_NUMBER.test(trimmed)) return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toBoolean(value: JsonValue): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/** Strings as is; numbers and booleans stringified; everything else is not a string. */
function toStringValue(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function isObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Evaluates a segment. `match: 'all'` (default) requires every condition,
 * `match: 'any'` at least one. An empty `all` segment matches everyone, an empty
 * `any` segment matches nobody. Segments cannot reference other segments; such
 * conditions never match. Malformed segments match nobody.
 */
export function matchSegment(segment: Segment, context: EvaluationContext): boolean {
  try {
    if (!isObject(segment) || !Array.isArray(segment.conditions)) return false
    const test = (condition: AttributeCondition) =>
      isObject(condition) &&
      condition.type === 'attribute' &&
      matchAttributeCondition(condition, context)
    return segment.match === 'any' ? segment.conditions.some(test) : segment.conditions.every(test)
  } catch {
    return false
  }
}

/**
 * Evaluates a rule: all conditions must match (logical AND); a rule without
 * conditions matches every context. A segment condition referencing an unknown
 * segment is false regardless of `negate`. Never throws.
 */
export function matchRule(
  rule: Rule,
  context: EvaluationContext,
  segments: Record<string, Segment>,
): RuleMatch {
  const noMatch: RuleMatch = { matched: false, matchedSegments: [] }
  try {
    if (!isObject(rule) || !Array.isArray(rule.conditions)) return noMatch
    const matchedSegments: string[] = []
    for (const condition of rule.conditions as Condition[]) {
      if (!matchCondition(condition, context, segments, matchedSegments)) return noMatch
    }
    return { matched: true, matchedSegments }
  } catch {
    return noMatch
  }
}

function matchCondition(
  condition: Condition,
  context: EvaluationContext,
  segments: Record<string, Segment>,
  matchedSegments: string[],
): boolean {
  if (!isObject(condition)) return false
  if (condition.type === 'attribute') return matchAttributeCondition(condition, context)
  if (condition.type !== 'segment') return false

  const key = condition.segmentKey
  if (typeof key !== 'string' || !isObject(segments) || !hasOwn(segments, key)) return false
  const segment = segments[key]
  if (!segment) return false

  const member = matchSegment(segment, context)
  if (condition.negate === true) return !member
  if (member) matchedSegments.push(key)
  return member
}
