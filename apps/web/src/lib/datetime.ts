const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-03-04T14:30` in local time, the shape kept in URL search params. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Parses `toLocalInput` output (or a bare `YYYY-MM-DD`) as local time. */
export function fromLocalInput(value: string | null | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value)
  if (!match) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const [, y, m, d, hh = '0', mm = '0'] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `14:30` for a time select value. */
export function toTimeValue(date: Date | null | undefined): string {
  return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : ''
}

export function parseTimeValue(value: string): { hours: number; minutes: number } | null {
  const [h, m] = value.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null
  return { hours: h, minutes: m }
}

/** Copies the calendar day of `day` and the clock time of `time` into one date. */
export function combineDayAndTime(day: Date, time: { hours: number; minutes: number }): Date {
  const next = new Date(day)
  next.setHours(time.hours, time.minutes, 0, 0)
  return next
}
