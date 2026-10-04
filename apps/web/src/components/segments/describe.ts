import type { AttributeCondition, JsonValue } from '@halyard/engine'
import { OPERATOR_LABELS } from '@/components/flags/operators'

const MAX_LIST_ITEMS = 4

function formatScalar(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatValue(value: JsonValue | undefined): string {
  if (!Array.isArray(value)) return formatScalar(value)
  const shown = value.slice(0, MAX_LIST_ITEMS).map(formatScalar)
  const rest = value.length - shown.length
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ')
}

/** "country is one of DE, AT", "email ends with @acme.com", "beta exists". */
export function describeCondition(condition: AttributeCondition): string {
  const attribute = condition.attribute || 'attribute'
  const operator = OPERATOR_LABELS[condition.operator] ?? condition.operator
  if (condition.operator === 'exists' || condition.operator === 'not_exists') {
    return `${attribute} ${operator}`
  }
  const value = formatValue(condition.value)
  return value === '' ? `${attribute} ${operator}` : `${attribute} ${operator} ${value}`
}

/** Joins conditions with " · " (all) or " or " (any). Empty segments describe themselves. */
export function describeConditions(
  conditions: AttributeCondition[],
  match: 'all' | 'any' = 'all',
): string {
  if (conditions.length === 0) return 'No conditions'
  return conditions.map(describeCondition).join(match === 'any' ? ' or ' : ' · ')
}
