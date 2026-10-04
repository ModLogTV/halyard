import type { JsonValue, Operator } from '@halyard/engine'

/** Translation key segment (under `flags:conditions.operators`) for every engine operator. */
export const OPERATOR_KEYS = {
  eq: 'eq',
  neq: 'neq',
  in: 'in',
  not_in: 'notIn',
  contains: 'contains',
  not_contains: 'notContains',
  starts_with: 'startsWith',
  ends_with: 'endsWith',
  regex: 'regex',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  semver_eq: 'semverEq',
  semver_gt: 'semverGt',
  semver_gte: 'semverGte',
  semver_lt: 'semverLt',
  semver_lte: 'semverLte',
  exists: 'exists',
  not_exists: 'notExists',
} as const satisfies Record<Operator, string>

export type OperatorKey = (typeof OPERATOR_KEYS)[Operator]

export type OperatorGroupKey =
  | 'equality'
  | 'lists'
  | 'strings'
  | 'numbers'
  | 'versions'
  | 'presence'

export interface OperatorGroup {
  /** Translation key segment (under `flags:conditions.operatorGroups`). */
  key: OperatorGroupKey
  /** English label. Prefer translating through `key`; kept for non-React callers. */
  operators: { value: Operator }[]
}

/** Operators grouped and labelled for humans, in display order. */
export const OPERATOR_GROUPS: OperatorGroup[] = [
  {
    key: 'equality',
    operators: [{ value: 'eq' }, { value: 'neq' }],
  },
  {
    key: 'lists',
    operators: [{ value: 'in' }, { value: 'not_in' }],
  },
  {
    key: 'strings',
    operators: [
      { value: 'contains' },
      { value: 'not_contains' },
      { value: 'starts_with' },
      { value: 'ends_with' },
      { value: 'regex' },
    ],
  },
  {
    key: 'numbers',
    operators: [{ value: 'gt' }, { value: 'gte' }, { value: 'lt' }, { value: 'lte' }],
  },
  {
    key: 'versions',
    operators: [
      { value: 'semver_eq' },
      { value: 'semver_gt' },
      { value: 'semver_gte' },
      { value: 'semver_lt' },
      { value: 'semver_lte' },
    ],
  },
  {
    key: 'presence',
    operators: [{ value: 'exists' }, { value: 'not_exists' }],
  },
]

export type ValueKind = 'none' | 'list' | 'number' | 'version' | 'regex' | 'equality' | 'text'

export function valueKind(operator: Operator): ValueKind {
  switch (operator) {
    case 'exists':
    case 'not_exists':
      return 'none'
    case 'in':
    case 'not_in':
      return 'list'
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return 'number'
    case 'semver_eq':
    case 'semver_gt':
    case 'semver_gte':
    case 'semver_lt':
    case 'semver_lte':
      return 'version'
    case 'regex':
      return 'regex'
    case 'eq':
    case 'neq':
      return 'equality'
    default:
      return 'text'
  }
}

/** Carries a condition value over to a new operator where that makes sense, otherwise drops it. */
export function coerceValue(
  operator: Operator,
  value: JsonValue | undefined,
): JsonValue | undefined {
  const kind = valueKind(operator)
  if (kind === 'none') return undefined
  if (kind === 'list') {
    if (Array.isArray(value)) return value
    return value === undefined || value === null || value === '' ? [] : [value]
  }
  const scalar = Array.isArray(value) ? value[0] : value
  if (scalar === undefined || scalar === null) return undefined
  if (kind === 'number') {
    if (typeof scalar === 'number') return scalar
    if (typeof scalar === 'string' && scalar.trim() !== '' && Number.isFinite(Number(scalar))) {
      return Number(scalar)
    }
    return undefined
  }
  if (kind === 'equality') return scalar
  return typeof scalar === 'string' ? scalar : String(scalar)
}
