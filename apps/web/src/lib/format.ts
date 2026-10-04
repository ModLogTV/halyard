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

/** `Mar 4, 2026, 2:15 PM` in the given locale (falls back to the runtime default). */
export function formatDateTime(date: Date | string | number, locale?: string): string {
  const d = toDate(date)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

/** `Mar 4, 2026` in the given locale. */
export function formatDate(date: Date | string | number, locale?: string): string {
  const d = toDate(date)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d)
}

/**
 * "now", "4 min. ago", "3 hr. ago", "2 days ago" (or "in 3 hr." for future dates),
 * localised through `Intl.RelativeTimeFormat`; anything a week or more away is a short date.
 */
export function formatRelativeTime(
  date: Date | string | number,
  opts: { now?: Date; locale?: string } = {},
): string {
  const d = toDate(date)
  if (Number.isNaN(d.getTime())) return '—'
  const now = opts.now ?? new Date()
  const seconds = Math.round((d.getTime() - now.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(opts.locale, { numeric: 'auto', style: 'short' })
  const magnitude = Math.abs(seconds)
  const sign = seconds < 0 ? -1 : 1
  if (magnitude < 45) return rtf.format(0, 'second')
  const minutes = Math.round(magnitude / 60)
  if (minutes < 60) return rtf.format(sign * Math.max(1, minutes), 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(sign * hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 7) return rtf.format(sign * days, 'day')
  return formatDate(d, opts.locale)
}
