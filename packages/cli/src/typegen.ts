import type { JsonValue } from '@halyard/engine'
import type { FlagSummary } from './api.js'

export interface GenerateTypesOptions {
  /** Project slug, printed in the header. */
  project: string
  /** Wrap the whole output in `export namespace <namespace> { … }`. */
  namespace?: string
  /** Keep archived flags (default: excluded). */
  includeArchived?: boolean
  /** ISO timestamp for the header. Defaults to now; pass it for reproducible output. */
  timestamp?: string
}

/** The subset of a flag the generator reads. */
export type TypegenFlag = Pick<FlagSummary, 'key' | 'name' | 'type' | 'variants'> &
  Partial<Pick<FlagSummary, 'description' | 'archived'>>

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const NAMESPACE = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/
const MAX_LINE = 100

/** A single quoted TypeScript string literal. */
export function quote(value: string): string {
  let out = ''
  for (const char of value) {
    switch (char) {
      case '\\':
        out += '\\\\'
        break
      case "'":
        out += "\\'"
        break
      case '\n':
        out += '\\n'
        break
      case '\r':
        out += '\\r'
        break
      case '\t':
        out += '\\t'
        break
      case ' ':
        out += '\\u2028'
        break
      case ' ':
        out += '\\u2029'
        break
      default: {
        const code = char.codePointAt(0) ?? 0
        out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, '0')}` : char
      }
    }
  }
  return `'${out}'`
}

/** An object key: bare when it is a valid identifier, quoted otherwise. */
export function propertyKey(key: string): string {
  return IDENTIFIER.test(key) ? key : quote(key)
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

function unionOf(members: string[]): string {
  return members.length === 0 ? 'never' : members.join(' | ')
}

/** Structural TypeScript type of a JSON value. Strings, numbers and booleans are widened. */
export function inferJsonType(value: JsonValue): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]'
    const members = unique(value.map(inferJsonType))
    const first = members[0] as string
    return members.length === 1 ? `${first}[]` : `(${members.join(' | ')})[]`
  }
  const entries = Object.keys(value)
    .sort(compare)
    .map((key) => `${propertyKey(key)}: ${inferJsonType(value[key] as JsonValue)}`)
  return entries.length === 0 ? 'Record<string, never>' : `{ ${entries.join('; ')} }`
}

/** A JSON value as a TypeScript expression. */
export function printValue(value: JsonValue): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return quote(value)
    case 'number':
    case 'boolean':
      return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(printValue).join(', ')}]`
  const entries = Object.keys(value)
    .sort(compare)
    .map((key) => `${propertyKey(key)}: ${printValue(value[key] as JsonValue)}`)
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Union of the literal variant values of one primitive type; the widened type when there are none. */
function literalUnion(
  values: JsonValue[],
  primitive: 'string' | 'number',
  print: (value: never) => string,
): string {
  const members = unique(
    values.map((value) => (typeof value === primitive ? print(value as never) : primitive)),
  )
  return members.length === 0 ? primitive : members.join(' | ')
}

function valueType(flag: TypegenFlag): string {
  const values = flag.variants.map((v) => v.value)
  switch (flag.type) {
    case 'boolean':
      return 'boolean'
    case 'string':
      return literalUnion(values, 'string', quote)
    case 'number':
      return literalUnion(values, 'number', String)
    case 'json': {
      const members = unique(values.map(inferJsonType))
      return members.length === 0 ? 'unknown' : members.join(' | ')
    }
  }
}

function defaultValue(flag: TypegenFlag): string {
  const first = flag.variants[0]?.value
  switch (flag.type) {
    case 'boolean':
      return typeof first === 'boolean' ? String(first) : 'false'
    case 'string':
      return typeof first === 'string' ? quote(first) : "''"
    case 'number':
      return typeof first === 'number' ? String(first) : '0'
    case 'json':
      return first === undefined ? 'null' : printValue(first)
  }
}

function docComment(flag: TypegenFlag, indent: string): string[] {
  const name = (flag.name ?? '').replace(/\s+/g, ' ').trim()
  const description = (flag.description ?? '').replace(/\s+/g, ' ').trim()
  const text = name && description ? `${name} — ${description}` : name || description
  if (!text) return []
  return [`${indent}/** ${text.replaceAll('*/', '*\\/')} */`]
}

/** `a | b | c` on one line when it fits, one member per line otherwise. */
function keyUnion(keys: string[], prefix: string): string[] {
  if (keys.length === 0) return [`${prefix} = never`]
  const oneLine = `${prefix} = ${keys.map(quote).join(' | ')}`
  if (oneLine.length <= MAX_LINE) return [oneLine]
  return [`${prefix} =`, ...keys.map((key) => `  | ${quote(key)}`)]
}

function pluralFlags(count: number): string {
  return `${count} ${count === 1 ? 'flag' : 'flags'}`
}

/**
 * Generates a TypeScript module describing the flags of a project. Pure and
 * deterministic: flags are sorted by key, and the only clock access is the
 * header timestamp, which can be injected.
 */
export function generateTypes(flags: TypegenFlag[], options: GenerateTypesOptions): string {
  const { namespace } = options
  if (namespace !== undefined && !NAMESPACE.test(namespace)) {
    throw new Error(`Invalid namespace "${namespace}": expected a TypeScript identifier.`)
  }

  const selected = flags
    .filter((flag) => options.includeArchived || !flag.archived)
    .sort((a, b) => compare(a.key, b.key))
  const keysOfType = (type: TypegenFlag['type']) =>
    selected.filter((flag) => flag.type === type).map((flag) => flag.key)
  const allKeys = selected.map((flag) => flag.key)

  const body: string[] = []

  body.push('/** All flag keys of the project. */')
  const arrayOneLine = `export const flagKeys = [${allKeys.map(quote).join(', ')}] as const`
  if (arrayOneLine.length <= MAX_LINE) {
    body.push(arrayOneLine)
  } else {
    body.push(
      'export const flagKeys = [',
      ...allKeys.map((key) => `  ${quote(key)},`),
      '] as const',
    )
  }
  body.push('', 'export type FlagKey = (typeof flagKeys)[number]', '')

  body.push(
    '/** The value type of every flag. String and number flags are unions of their variant values. */',
  )
  if (selected.length === 0) {
    body.push('export interface Flags {}')
  } else {
    body.push('export interface Flags {')
    for (const flag of selected) {
      body.push(...docComment(flag, '  '))
      body.push(`  ${propertyKey(flag.key)}: ${valueType(flag)}`)
    }
    body.push('}')
  }
  body.push('', 'export type FlagValue<K extends FlagKey> = Flags[K]', '')

  body.push('/** Variant keys per flag. */')
  if (selected.length === 0) {
    body.push('export interface FlagVariants {}')
  } else {
    body.push('export interface FlagVariants {')
    for (const flag of selected) {
      const keys = unique(flag.variants.map((v) => quote(v.key)))
      body.push(`  ${propertyKey(flag.key)}: ${unionOf(keys)}`)
    }
    body.push('}')
  }
  body.push('')

  body.push("/** Code defaults: the value of each flag's first variant. Override as needed. */")
  if (selected.length === 0) {
    body.push('export const flagDefaults: { [K in FlagKey]: Flags[K] } = {}')
  } else {
    body.push('export const flagDefaults: { [K in FlagKey]: Flags[K] } = {')
    for (const flag of selected) {
      body.push(`  ${propertyKey(flag.key)}: ${defaultValue(flag)},`)
    }
    body.push('}')
  }
  body.push('')

  body.push(
    '/** Typed wrapper for an OpenFeature client. */',
    'export interface TypedFlagClient {',
    '  getBooleanValue<K extends BooleanFlagKey>(key: K, defaultValue: Flags[K], context?: unknown): Promise<Flags[K]>',
    '  getStringValue<K extends StringFlagKey>(key: K, defaultValue: Flags[K], context?: unknown): Promise<Flags[K]>',
    '  getNumberValue<K extends NumberFlagKey>(key: K, defaultValue: Flags[K], context?: unknown): Promise<Flags[K]>',
    '  getObjectValue<K extends JsonFlagKey>(key: K, defaultValue: Flags[K], context?: unknown): Promise<Flags[K]>',
    '}',
    '',
    '/** Keys of boolean flags. */',
    ...keyUnion(keysOfType('boolean'), 'export type BooleanFlagKey'),
    '',
    '/** Keys of string flags. */',
    ...keyUnion(keysOfType('string'), 'export type StringFlagKey'),
    '',
    '/** Keys of number flags. */',
    ...keyUnion(keysOfType('number'), 'export type NumberFlagKey'),
    '',
    '/** Keys of JSON flags. */',
    ...keyUnion(keysOfType('json'), 'export type JsonFlagKey'),
  )

  const timestamp = options.timestamp ?? new Date().toISOString()
  const header = [
    '// Generated by @halyard/cli — do not edit by hand.',
    `// Project: ${options.project} · ${pluralFlags(selected.length)} · ${timestamp}`,
    '',
  ]

  const content = namespace
    ? [`export namespace ${namespace} {`, ...body.map((line) => (line ? `  ${line}` : line)), '}']
    : body

  return `${[...header, ...content].join('\n')}\n`
}
