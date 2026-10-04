import type { AttributeCondition, JsonValue } from '@halyard/engine'
import { OPERATOR_KEYS, type OperatorKey } from '@/components/flags/operators'

const MAX_LIST_ITEMS = 4

/** The slice of `t` the describe helpers need; any `useTranslation` result that includes `segments` and `flags` fits. */
export type DescribeT = (
  key:
    | `flags:conditions.operators.${OperatorKey}`
    | 'segments:describe.noConditions'
    | 'segments:describe.attributeFallback'
    | 'segments:describe.moreItems'
    | 'segments:describe.joinAll'
    | 'segments:describe.joinAny',
  options?: { count?: number },
) => string

function formatScalar(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatValue(value: JsonValue | undefined, t: DescribeT): string {
  if (!Array.isArray(value)) return formatScalar(value)
  const shown = value.slice(0, MAX_LIST_ITEMS).map(formatScalar)
  const rest = value.length - shown.length
  return rest > 0
    ? `${shown.join(', ')} ${t('segments:describe.moreItems', { count: rest })}`
    : shown.join(', ')
}

/** "country is one of DE, AT", "email ends with @acme.com", "beta exists". */
export function describeCondition(condition: AttributeCondition, t: DescribeT): string {
  const attribute = condition.attribute || t('segments:describe.attributeFallback')
  const operator = t(`flags:conditions.operators.${OPERATOR_KEYS[condition.operator]}`)
  if (condition.operator === 'exists' || condition.operator === 'not_exists') {
    return `${attribute} ${operator}`
  }
  const value = formatValue(condition.value, t)
  return value === '' ? `${attribute} ${operator}` : `${attribute} ${operator} ${value}`
}

/** Joins conditions with " · " (all) or " or " (any), localised. Empty segments describe themselves. */
export function describeConditions(
  conditions: AttributeCondition[],
  match: 'all' | 'any',
  t: DescribeT,
): string {
  if (conditions.length === 0) return t('segments:describe.noConditions')
  const separator = t(match === 'any' ? 'segments:describe.joinAny' : 'segments:describe.joinAll')
  return conditions.map((condition) => describeCondition(condition, t)).join(separator)
}
