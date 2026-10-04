import type { JsonValue, Operator } from '@halyard/engine'

export interface OperatorGroup {
  label: string
  operators: { value: Operator; label: string }[]
}

/** Operators grouped and labelled for humans, in display order. */
export const OPERATOR_GROUPS: OperatorGroup[] = [
  {
    label: 'Equality',
    operators: [
      { value: 'eq', label: 'is' },
      { value: 'neq', label: 'is not' },
    ],
  },
  {
    label: 'Lists',
    operators: [
      { value: 'in', label: 'is one of' },
      { value: 'not_in', label: 'is not one of' },
    ],
  },
  {
    label: 'Strings',
    operators: [
      { value: 'contains', label: 'contains' },
      { value: 'not_contains', label: 'does not contain' },
      { value: 'starts_with', label: 'starts with' },
      { value: 'ends_with', label: 'ends with' },
      { value: 'regex', label: 'matches regex' },
    ],
  },
  {
    label: 'Numbers',
    operators: [
      { value: 'gt', label: '>' },
      { value: 'gte', label: '≥' },
      { value: 'lt', label: '<' },
      { value: 'lte', label: '≤' },
    ],
  },
  {
    label: 'Versions',
    operators: [
      { value: 'semver_eq', label: 'semver =' },
      { value: 'semver_gt', label: 'semver >' },
      { value: 'semver_gte', label: 'semver ≥' },
      { value: 'semver_lt', label: 'semver <' },
      { value: 'semver_lte', label: 'semver ≤' },
    ],
  },
  {
    label: 'Presence',
    operators: [
      { value: 'exists', label: 'exists' },
      { value: 'not_exists', label: 'does not exist' },
    ],
  },
]

export const OPERATOR_LABELS = Object.fromEntries(
  OPERATOR_GROUPS.flatMap((group) => group.operators.map((op) => [op.value, op.label])),
) as Record<Operator, string>

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
