import type { FlagType, JsonValue } from '@halyard/engine'

const ELLIPSIS = '…'

function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0 || text.length <= maxLength) return text
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}${ELLIPSIS}`
}

/**
 * Compact, single-line text for a variant value. Booleans are `true` / `false`,
 * strings are shown raw (an empty string as `""`), numbers as-is and anything else
 * as compact JSON. Long output is truncated with an ellipsis.
 */
export function formatVariantValue(
  value: JsonValue,
  type: FlagType,
  opts: { maxLength?: number } = {},
): string {
  const maxLength = opts.maxLength ?? 40
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (type === 'json') return truncate(JSON.stringify(value), maxLength)
    return value === '' ? '""' : truncate(value, maxLength)
  }
  if (value === null || value === undefined) return 'null'
  return truncate(JSON.stringify(value) ?? 'null', maxLength)
}

/** `50` -> `50%`, `33.3333` -> `33.333%`. Trailing zeros are stripped, up to three decimals. */
export function formatPercent(weight: number): string {
  if (!Number.isFinite(weight)) return '0%'
  return `${Number(weight.toFixed(3))}%`
}

function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input)
}

/** `Mar 4, 2026, 2:15 PM` in the viewer's locale. */
export function formatDateTime(date: Date | string | number): string {
  const d = toDate(date)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

/** "just now", "4 min ago", "3 h ago", "2 days ago", otherwise a short date. */
export function formatRelativeTime(date: Date | string | number, now: Date = new Date()): string {
  const d = toDate(date)
  if (Number.isNaN(d.getTime())) return '—'
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000)
  if (Math.abs(seconds) < 45) return 'just now'
  if (seconds > 0) {
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${Math.max(1, minutes)} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} h ago`
    const days = Math.round(hours / 24)
    if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d)
}

/** `pluralize(1, 'rule')` -> `1 rule`, `pluralize(2, 'rule')` -> `2 rules`. The count is included. */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`)
  return `${count} ${word}`
}
