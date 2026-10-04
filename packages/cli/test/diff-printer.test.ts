import { describe, expect, it } from 'vitest'
import type { ImportDiff } from '../src/api.js'
import { createColors } from '../src/colors.js'
import { countChanges, formatDiff, formatValue, hasChanges } from '../src/diff-printer.js'

const plain = createColors(false)
const section = (partial: Partial<ImportDiff['flags']> = {}): ImportDiff['flags'] => ({
  create: [],
  update: [],
  delete: [],
  unchanged: 0,
  ...partial,
})

const diff: ImportDiff = {
  environments: section({ create: [{ key: 'staging', name: 'Staging' }], unchanged: 2 }),
  segments: section({
    update: [{ key: 'beta', changes: [{ field: 'match', before: 'all', after: 'any' }] }],
    delete: [{ key: 'legacy' }],
  }),
  flags: section({
    create: [{ key: 'new-flag', name: 'new-flag' }, { key: 'other' }],
    update: [
      {
        key: 'checkout',
        changes: [
          { field: 'description', before: null, after: 'Faster' },
          { field: 'tags', before: ['a'], after: ['a', 'b'] },
        ],
        environments: {
          production: { changes: [{ field: 'enabled', before: false, after: true }] },
          staging: { changes: [] },
        },
      },
    ],
    delete: [{ key: 'gone' }],
    unchanged: 12,
  }),
}

describe('formatDiff', () => {
  it('renders sections with created, updated, deleted and unchanged entries', () => {
    expect(formatDiff(diff, plain)).toEqual([
      'Environments',
      '  + staging  (Staging)',
      '  = 2 unchanged',
      '',
      'Segments',
      '  ~ beta',
      '      match: "all" → "any"',
      '  - legacy',
      '',
      'Flags',
      '  + new-flag',
      '  + other',
      '  ~ checkout',
      '      description: null → "Faster"',
      '      tags: ["a"] → ["a","b"]',
      '      [production]',
      '        enabled: false → true',
      '  - gone',
      '  = 12 unchanged',
      '',
      '3 to create, 2 to update, 2 to delete, 14 unchanged',
    ])
  })

  it('marks empty sections', () => {
    const lines = formatDiff(
      { environments: section(), segments: section(), flags: section() },
      plain,
    )
    expect(lines.filter((l) => l === '  (none)')).toHaveLength(3)
    expect(lines.at(-1)).toBe('0 unchanged')
  })

  it('tolerates missing sections and fields', () => {
    const lines = formatDiff({ flags: { create: [{ key: 'x' }] } } as unknown as ImportDiff, plain)
    expect(lines).toContain('  + x')
    expect(formatDiff(undefined, plain).at(-1)).toBe('0 unchanged')
  })

  it('colours symbols and values with ANSI codes when enabled', () => {
    const out = formatDiff(diff, createColors(true)).join('\n')
    expect(out).toContain('\u001b[32m+\u001b[39m')
    expect(out).toContain('\u001b[33m~\u001b[39m')
    expect(out).toContain('\u001b[31m-\u001b[39m')
    expect(out).toContain('\u001b[31mfalse\u001b[39m → \u001b[32mtrue\u001b[39m')
  })

  it('contains no ANSI codes when disabled', () => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
    expect(formatDiff(diff, plain).join('\n')).not.toMatch(/\u001b/)
  })
})

describe('counts', () => {
  it('sums all sections', () => {
    expect(countChanges(diff)).toEqual({ create: 3, update: 2, delete: 2, unchanged: 14 })
    expect(hasChanges(diff)).toBe(true)
  })

  it('reports no changes when only unchanged entries exist', () => {
    expect(
      hasChanges({
        environments: section({ unchanged: 3 }),
        segments: section(),
        flags: section(),
      }),
    ).toBe(false)
    expect(hasChanges(undefined)).toBe(false)
  })
})

describe('formatValue', () => {
  it('renders JSON, marks unset values and truncates long ones', () => {
    expect(formatValue('x')).toBe('"x"')
    expect(formatValue(undefined)).toBe('(unset)')
    expect(formatValue({ a: [1] })).toBe('{"a":[1]}')
    const long = formatValue('x'.repeat(200))
    expect(long.length).toBe(80)
    expect(long.endsWith('…')).toBe(true)
  })
})
