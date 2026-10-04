import type { EvaluationContext, JsonValue } from '@halyard/engine'

export type AttributeType = 'string' | 'number' | 'boolean' | 'json'

export interface AttributeRow {
  id: string
  key: string
  type: AttributeType
  /** Raw text. Booleans are `'true'` or `'false'`. */
  value: string
}

/** Editable form of an evaluation context. */
export interface ContextDraft {
  targetingKey: string
  rows: AttributeRow[]
}

export interface BuiltContext {
  context: EvaluationContext
  /** Problems keyed by row id. */
  errors: Record<string, string>
}

let counter = 0
export const newRowId = () => `attr-${Date.now().toString(36)}-${counter++}`

export const emptyDraft = (): ContextDraft => ({ targetingKey: '', rows: [] })

export function newRow(partial: Partial<Omit<AttributeRow, 'id'>> = {}): AttributeRow {
  return { id: newRowId(), key: '', type: 'string', value: '', ...partial }
}

export function parseRowValue(row: Pick<AttributeRow, 'type' | 'value'>): {
  value?: JsonValue
  error?: string
} {
  switch (row.type) {
    case 'string':
      return { value: row.value }
    case 'number': {
      const text = row.value.trim()
      const parsed = Number(text)
      if (text === '' || !Number.isFinite(parsed)) return { error: 'Enter a valid number' }
      return { value: parsed }
    }
    case 'boolean':
      return { value: row.value === 'true' }
    case 'json':
      try {
        return { value: JSON.parse(row.value) as JsonValue }
      } catch {
        return { error: 'Enter valid JSON' }
      }
  }
}

/** Builds the context to evaluate. Rows with errors are left out and reported. */
export function draftToContext(draft: ContextDraft): BuiltContext {
  const context: EvaluationContext = {}
  const errors: Record<string, string> = {}
  const targetingKey = draft.targetingKey.trim()
  if (targetingKey) context.targetingKey = targetingKey
  const seen = new Set<string>()
  for (const row of draft.rows) {
    const key = row.key.trim()
    if (!key) {
      if (row.value.trim()) errors[row.id] = 'Name the attribute'
      continue
    }
    if (key === 'targetingKey') {
      errors[row.id] = 'Use the targeting key field'
      continue
    }
    if (seen.has(key)) {
      errors[row.id] = 'Duplicate attribute'
      continue
    }
    seen.add(key)
    const parsed = parseRowValue(row)
    if (parsed.error) errors[row.id] = parsed.error
    else context[key] = parsed.value as JsonValue
  }
  return { context, errors }
}

function rowFromValue(key: string, value: JsonValue): AttributeRow {
  if (typeof value === 'string') return newRow({ key, type: 'string', value })
  if (typeof value === 'number') return newRow({ key, type: 'number', value: String(value) })
  if (typeof value === 'boolean') return newRow({ key, type: 'boolean', value: String(value) })
  return newRow({ key, type: 'json', value: JSON.stringify(value) })
}

export function contextToDraft(context: Record<string, JsonValue | undefined>): ContextDraft {
  const { targetingKey, ...rest } = context
  return {
    targetingKey: typeof targetingKey === 'string' ? targetingKey : '',
    rows: Object.entries(rest)
      .filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
      .map(([key, value]) => rowFromValue(key, value)),
  }
}

export function parseContextJson(text: string): { draft: ContextDraft } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'The context must be a JSON object' }
  }
  if (
    'targetingKey' in parsed &&
    typeof (parsed as Record<string, unknown>).targetingKey !== 'string'
  ) {
    return { error: 'targetingKey must be a string' }
  }
  return { draft: contextToDraft(parsed as Record<string, JsonValue>) }
}

export function isContextEmpty(context: EvaluationContext): boolean {
  return Object.keys(context).length === 0
}

// base64url encoding of the context, for shareable search params.

export function encodeContext(context: EvaluationContext): string | undefined {
  if (isContextEmpty(context)) return undefined
  const bytes = new TextEncoder().encode(JSON.stringify(context))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeContext(encoded: string | undefined): Record<string, JsonValue> | undefined {
  if (!encoded) return undefined
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, JsonValue>
  } catch {
    return undefined
  }
}

// Presets

export interface ContextPreset {
  id: string
  name: string
  description?: string
  context: Record<string, JsonValue>
}

export const BUILT_IN_PRESETS: ContextPreset[] = [
  {
    id: 'builtin:beta',
    name: 'Beta tester',
    description: 'Signed-in user in the beta programme',
    context: {
      targetingKey: 'user-42',
      beta: true,
      email: 'beta@example.com',
      plan: 'pro',
    },
  },
  {
    id: 'builtin:eu',
    name: 'EU customer',
    description: 'Customer based in Germany',
    context: {
      targetingKey: 'user-eu-1',
      country: 'DE',
      email: 'anna@example.de',
      plan: 'team',
    },
  },
  {
    id: 'builtin:free',
    name: 'Free plan',
    description: 'Free plan user in the US',
    context: {
      targetingKey: 'user-free-1',
      country: 'US',
      email: 'sam@example.com',
      plan: 'free',
    },
  },
  {
    id: 'builtin:anonymous',
    name: 'Anonymous',
    description: 'No targeting key, as for a logged-out visitor',
    context: { country: 'US' },
  },
]

const storageKey = (projectId: string) => `halyard:playground-presets:${projectId}`

export function loadPresets(projectId: string): ContextPreset[] {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ContextPreset =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.context === 'object' &&
        item.context !== null,
    )
  } catch {
    return []
  }
}

export function savePresets(projectId: string, presets: ContextPreset[]): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(presets))
  } catch {
    // Storage may be unavailable (private mode); presets then last for the session only.
  }
}
