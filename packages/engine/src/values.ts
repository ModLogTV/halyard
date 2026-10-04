import type { FlagType, JsonValue } from './types.js'

export const FLAG_TYPES: readonly FlagType[] = ['boolean', 'string', 'number', 'json']

/**
 * Whether `value` is plain JSON data: strings, finite numbers, booleans, `null`,
 * arrays and plain objects thereof. Cyclic structures are rejected.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  return checkJson(value, new Set())
}

function checkJson(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false

  const isArray = Array.isArray(value)
  if (!isArray) {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false
  }

  ancestors.add(value)
  const children: unknown[] = isArray ? value : Object.values(value)
  const ok = children.every((child) => checkJson(child, ancestors))
  ancestors.delete(value)
  return ok
}

/**
 * Whether a variant value is valid for a flag type:
 * `boolean` → boolean, `string` → string, `number` → finite number, `json` → any JSON value.
 */
export function valueMatchesType(value: unknown, type: FlagType): value is JsonValue {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'json':
      return isJsonValue(value)
    default:
      return false
  }
}
