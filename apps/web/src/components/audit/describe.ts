import type { JsonValue } from '@modlogtv/halyard-engine'

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

export type AuditEntityKey =
  | 'project'
  | 'environment'
  | 'flag'
  | 'segment'
  | 'experiment'
  | 'schedule'
  | 'webhook'
  | 'apiKey'
  | 'member'

/** Audit entity type (as stored) to the key of `audit:timeline.entities.*`. */
const ENTITY_KEYS: Record<string, AuditEntityKey> = {
  project: 'project',
  environment: 'environment',
  flag: 'flag',
  segment: 'segment',
  experiment: 'experiment',
  schedule: 'schedule',
  webhook: 'webhook',
  api_key: 'apiKey',
  member: 'member',
}

export type AuditActionKey =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'archived'
  | 'unarchived'
  | 'promoted'
  | 'invited'
  | 'invitationCanceled'
  | 'roleChanged'
  | 'removed'
  | 'environmentUpdated'
  | 'started'
  | 'stopped'
  | 'completed'
  | 'rotated'
  | 'revoked'
  | 'toggled'
  | 'enabled'
  | 'disabled'
  | 'memberJoined'
  | 'memberLeft'
  | 'raw'

/** Stored action name (the part after the entity) to the key of `audit:timeline.actions.*`. */
const VERBS: Record<string, AuditActionKey> = {
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
  archived: 'archived',
  unarchived: 'unarchived',
  promoted: 'promoted',
  invited: 'invited',
  invitation_canceled: 'invitationCanceled',
  role_changed: 'roleChanged',
  removed: 'removed',
  environment_updated: 'environmentUpdated',
  started: 'started',
  stopped: 'stopped',
  completed: 'completed',
  rotated: 'rotated',
  revoked: 'revoked',
}

export interface AuditSentence {
  /** Key of `audit:timeline.actions.*`; `raw` when the action was not recognised. */
  actionKey: AuditActionKey
  /** Entity such as `flag` or `apiKey`; absent when the sentence has no entity (`joined the project`). */
  entity?: AuditEntityKey
  /** Preposition before the environment: "in production", "to production". */
  environmentPreposition: 'in' | 'to'
  /** True when the action was not recognised and the raw action is shown. */
  raw: boolean
}

const enabledOf = (value: JsonValue | null): boolean | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const enabled = value.enabled
    if (typeof enabled === 'boolean') return enabled
  }
  return undefined
}

/** Derives the sentence kind for an audit entry; unknown actions fall back to the raw action. */
export function describeAuditAction(entry: AuditEntryLike): AuditSentence {
  const [entity = '', ...rest] = entry.action.split('.')
  const name = rest.join('.')
  const entityKey = ENTITY_KEYS[entry.entityType] ?? ENTITY_KEYS[entity]
  const base = { environmentPreposition: 'in' as const }

  if (entity === 'member' && name === 'joined') {
    return { ...base, actionKey: 'memberJoined', raw: false }
  }
  if (entity === 'member' && name === 'left') {
    return { ...base, actionKey: 'memberLeft', raw: false }
  }
  if (name === 'toggled') {
    const enabled = enabledOf(entry.after)
    const actionKey = enabled === undefined ? 'toggled' : enabled ? 'enabled' : 'disabled'
    return { ...base, actionKey, entity: entityKey, raw: false }
  }
  if (name === 'promoted') {
    return { actionKey: 'promoted', entity: entityKey, environmentPreposition: 'to', raw: false }
  }
  const actionKey = VERBS[name]
  if (actionKey) return { ...base, actionKey, entity: entityKey, raw: false }
  return { ...base, actionKey: 'raw', raw: true }
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

/** Translator slice used for day headings. */
export type DayLabelT = (key: 'audit:timeline.today' | 'audit:timeline.yesterday') => string

export function dayLabel(
  date: Date | string,
  t: DayLabelT,
  locale?: string,
  now: Date = new Date(),
): string {
  const d = new Date(date)
  if (dayKey(d) === dayKey(now)) return t('audit:timeline.today')
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(d) === dayKey(yesterday)) return t('audit:timeline.yesterday')
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(d)
}
