import type { JsonValue } from '@halyard/engine'
import { cn } from '@/lib/utils'

export type DiffKind = 'added' | 'removed' | 'changed'

export interface DiffEntry {
  path: string
  kind: DiffKind
  before?: JsonValue
  after?: JsonValue
}

const isContainer = (value: unknown): value is Record<string, JsonValue> | JsonValue[] =>
  typeof value === 'object' && value !== null

/** Flattens nested objects and arrays to dotted paths (`rules[0].serve.variant`). Empty containers are leaves. */
export function flattenJson(value: JsonValue | undefined, prefix = ''): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>()
  const walk = (current: JsonValue | undefined, path: string) => {
    if (current === undefined) return
    if (isContainer(current) && Object.keys(current).length > 0) {
      if (Array.isArray(current)) {
        current.forEach((item, index) => {
          walk(item, `${path}[${index}]`)
        })
      } else {
        for (const [key, child] of Object.entries(current)) {
          walk(child, path ? `${path}.${key}` : key)
        }
      }
      return
    }
    out.set(path || '(value)', current)
  }
  walk(value, prefix)
  return out
}

const same = (a: JsonValue, b: JsonValue) => JSON.stringify(a) === JSON.stringify(b)

/** Paths that were added, removed or changed between two JSON values, sorted by path. */
export function diffJson(
  before: JsonValue | null | undefined,
  after: JsonValue | null | undefined,
): DiffEntry[] {
  const a = flattenJson(before ?? undefined)
  const b = flattenJson(after ?? undefined)
  const entries: DiffEntry[] = []
  for (const [path, value] of a) {
    if (!b.has(path)) entries.push({ path, kind: 'removed', before: value })
    else {
      const next = b.get(path) as JsonValue
      if (!same(value, next)) entries.push({ path, kind: 'changed', before: value, after: next })
    }
  }
  for (const [path, value] of b) {
    if (!a.has(path)) entries.push({ path, kind: 'added', after: value })
  }
  return entries.sort((x, y) => x.path.localeCompare(y.path, undefined, { numeric: true }))
}

const MAX_VALUE_LENGTH = 160
const MAX_ROWS = 100

function show(value: JsonValue | undefined): string {
  const text = JSON.stringify(value) ?? 'undefined'
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text
}

const SIGN: Record<DiffKind, { glyph: string; label: string }> = {
  added: { glyph: '+', label: 'Added' },
  removed: { glyph: '−', label: 'Removed' },
  changed: { glyph: '~', label: 'Changed' },
}

const ADDED = 'bg-on-soft'
const REMOVED = 'bg-destructive/10'

/**
 * Compact diff of two JSON documents: each added, removed or changed dotted path on its own
 * row with the old and new value in monospace.
 */
export function JsonDiff({
  before,
  after,
  className,
}: {
  before: JsonValue | null | undefined
  after: JsonValue | null | undefined
  className?: string
}) {
  const entries = diffJson(before, after)
  if (entries.length === 0) {
    return <p className={cn('text-muted-foreground text-xs', className)}>No field changes.</p>
  }
  const visible = entries.slice(0, MAX_ROWS)
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <ul className="flex flex-col divide-y overflow-hidden rounded-md border font-mono text-xs">
        {visible.map((entry) => (
          <li key={entry.path} className="flex flex-col gap-1 px-2.5 py-1.5">
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'w-3 shrink-0 text-center font-semibold',
                  entry.kind === 'added' && 'text-foreground',
                  entry.kind === 'removed' && 'text-destructive',
                  entry.kind === 'changed' && 'text-muted-foreground',
                )}
              >
                {SIGN[entry.kind].glyph}
              </span>
              <span className="sr-only">{SIGN[entry.kind].label}</span>
              <span className="min-w-0 break-all font-medium">{entry.path}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pl-5">
              {entry.kind !== 'added' ? (
                <code
                  className={cn(
                    'break-all rounded px-1.5 py-0.5',
                    REMOVED,
                    entry.kind === 'changed' && 'line-through decoration-destructive/50',
                  )}
                >
                  {show(entry.before)}
                </code>
              ) : null}
              {entry.kind === 'changed' ? (
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
              ) : null}
              {entry.kind !== 'removed' ? (
                <code className={cn('break-all rounded px-1.5 py-0.5', ADDED)}>
                  {show(entry.after)}
                </code>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {entries.length > MAX_ROWS ? (
        <p className="text-muted-foreground text-xs">
          and {entries.length - MAX_ROWS} more changed fields
        </p>
      ) : null}
    </div>
  )
}
