import type { DiffChange, DiffSection, ImportDiff } from './api.js'
import type { Colors } from './colors.js'

const SECTIONS = [
  ['environments', 'Environments'],
  ['segments', 'Segments'],
  ['flags', 'Flags'],
] as const

const MAX_VALUE_LENGTH = 80

/** A short, single-line rendering of a changed value. */
export function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)'
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text
}

interface NormalizedSection {
  create: { key: string; label?: string }[]
  update: { key: string; changes: DiffChange[]; environments: [string, DiffChange[]][] }[]
  delete: string[]
  unchanged: number
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : []
}

/** The server may omit parts of a section; treat missing parts as empty. */
function normalize(section: Partial<DiffSection> | undefined): NormalizedSection {
  return {
    create: asArray(section?.create).map((entry) => ({
      key: entry.key,
      label: typeof entry.name === 'string' && entry.name !== entry.key ? entry.name : undefined,
    })),
    update: asArray(section?.update).map((entry) => ({
      key: entry.key,
      changes: asArray(entry.changes),
      environments: Object.entries(entry.environments ?? {})
        .map(([env, value]): [string, DiffChange[]] => [env, asArray(value?.changes)])
        .filter(([, changes]) => changes.length > 0),
    })),
    delete: asArray(section?.delete).map((entry) => entry.key),
    unchanged: typeof section?.unchanged === 'number' ? section.unchanged : 0,
  }
}

export interface DiffCounts {
  create: number
  update: number
  delete: number
  unchanged: number
}

export function countChanges(diff: Partial<ImportDiff> | undefined): DiffCounts {
  const counts: DiffCounts = { create: 0, update: 0, delete: 0, unchanged: 0 }
  for (const [key] of SECTIONS) {
    const section = normalize(diff?.[key])
    counts.create += section.create.length
    counts.update += section.update.length
    counts.delete += section.delete.length
    counts.unchanged += section.unchanged
  }
  return counts
}

export function hasChanges(diff: Partial<ImportDiff> | undefined): boolean {
  const { create, update, delete: del } = countChanges(diff)
  return create + update + del > 0
}

function changeLines(changes: DiffChange[], indent: string, c: Colors): string[] {
  return changes.map(
    (change) =>
      `${indent}${change.field}: ${c.red(formatValue(change.before))} → ${c.green(formatValue(change.after))}`,
  )
}

/**
 * Renders the diff of an import response as lines (no trailing newlines):
 * one block per section with `+ created`, `~ updated` (with field changes),
 * `- deleted` and `= n unchanged`, followed by a one line summary.
 */
export function formatDiff(diff: Partial<ImportDiff> | undefined, c: Colors): string[] {
  const lines: string[] = []
  for (const [key, title] of SECTIONS) {
    const section = normalize(diff?.[key])
    lines.push(c.bold(title))
    const empty =
      section.create.length + section.update.length + section.delete.length + section.unchanged ===
      0
    if (empty) {
      lines.push(`  ${c.dim('(none)')}`)
    }
    for (const entry of section.create) {
      lines.push(`  ${c.green('+')} ${entry.key}${entry.label ? c.dim(`  (${entry.label})`) : ''}`)
    }
    for (const entry of section.update) {
      lines.push(`  ${c.yellow('~')} ${entry.key}`)
      lines.push(...changeLines(entry.changes, '      ', c))
      for (const [env, changes] of entry.environments) {
        lines.push(`      ${c.cyan(`[${env}]`)}`)
        lines.push(...changeLines(changes, '        ', c))
      }
    }
    for (const entry of section.delete) {
      lines.push(`  ${c.red('-')} ${entry}`)
    }
    if (section.unchanged > 0) {
      lines.push(c.dim(`  = ${section.unchanged} unchanged`))
    }
    lines.push('')
  }
  lines.push(summarize(countChanges(diff), c))
  return lines
}

export function summarize(counts: DiffCounts, c: Colors): string {
  const parts: string[] = []
  if (counts.create) parts.push(c.green(`${counts.create} to create`))
  if (counts.update) parts.push(c.yellow(`${counts.update} to update`))
  if (counts.delete) parts.push(c.red(`${counts.delete} to delete`))
  parts.push(`${counts.unchanged} unchanged`)
  return parts.join(', ')
}
