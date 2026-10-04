import type { JsonValue } from '@halyard/engine'

export interface AuditEntryLike {
  id: string
  actorType: 'user' | 'api_key' | 'system'
  actorId?: string | null
  actorName: string
  action: string
  entityType: string
  entityId: string
  entityKey: string | null
  environmentId: string | null
  before: JsonValue | null
  after: JsonValue | null
  createdAt: Date | string
}

const ENTITY_LABELS: Record<string, string> = {
  project: 'project',
  environment: 'environment',
  flag: 'flag',
  segment: 'segment',
  experiment: 'experiment',
  schedule: 'schedule',
  webhook: 'webhook',
  api_key: 'API key',
  member: 'member',
}

const VERBS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
  archived: 'archived',
  unarchived: 'restored',
  promoted: 'promoted',
  invited: 'invited',
  invitation_canceled: 'canceled the invitation for',
  role_changed: 'changed the role of',
  removed: 'removed',
  environment_updated: 'updated the targeting of',
  started: 'started',
  stopped: 'stopped',
  completed: 'completed',
  rotated: 'rotated',
  revoked: 'revoked',
}

export interface AuditSentence {
  verb: string
  /** Label such as `flag` or `API key`; absent when the verb stands alone (`joined the project`). */
  entityLabel?: string
  /** Preposition before the environment: "in production", "to production". */
  environmentPreposition: 'in' | 'to'
  /** True when the action was not recognised and `verb` is the raw action. */
  raw: boolean
}

const enabledOf = (value: JsonValue | null): boolean | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const enabled = value.enabled
    if (typeof enabled === 'boolean') return enabled
  }
  return undefined
}

/** Derives the human verb for an audit entry; falls back to the raw action. */
export function describeAuditAction(entry: AuditEntryLike): AuditSentence {
  const [entity = '', ...rest] = entry.action.split('.')
  const name = rest.join('.')
  const entityLabel = ENTITY_LABELS[entry.entityType] ?? ENTITY_LABELS[entity]
  const base = { environmentPreposition: 'in' as const }

  if (entity === 'member' && name === 'joined') {
    return { ...base, verb: 'joined the project', raw: false }
  }
  if (entity === 'member' && name === 'left') {
    return { ...base, verb: 'left the project', raw: false }
  }
  if (name === 'toggled') {
    const enabled = enabledOf(entry.after)
    const verb = enabled === undefined ? 'toggled' : enabled ? 'enabled' : 'disabled'
    return { ...base, verb, entityLabel, raw: false }
  }
  if (name === 'promoted') {
    return { verb: 'promoted', entityLabel, environmentPreposition: 'to', raw: false }
  }
  const verb = VERBS[name]
  if (verb) return { ...base, verb, entityLabel, raw: false }
  return { ...base, verb: entry.action, entityLabel: undefined, raw: true }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0] as string
  const last = parts.length > 1 ? (parts[parts.length - 1] as string) : ''
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

/** Local calendar day, used to group entries. */
export function dayKey(date: Date | string): string {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayLabel(date: Date | string, now: Date = new Date()): string {
  const d = new Date(date)
  if (dayKey(d) === dayKey(now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(d)
}
