import type { JsonValue } from '@modlogtv/halyard-engine'
import type { DbOrTx } from '@/db'
import { auditLog } from '@/db/schema'
import { enqueueWebhookDeliveries } from './webhook-queue'

export type AuditActor =
  | { type: 'user'; id: string; name: string }
  | { type: 'api_key'; id: string; name: string }
  | { type: 'system'; name: string }

export interface AuditEntry {
  projectId: string
  environmentId?: string | null
  actor: AuditActor
  /** Dotted action name, for example `flag.updated`. */
  action: string
  entityType:
    | 'project'
    | 'environment'
    | 'flag'
    | 'segment'
    | 'experiment'
    | 'schedule'
    | 'webhook'
    | 'api_key'
    | 'member'
  entityId: string
  entityKey?: string | null
  before?: unknown
  after?: unknown
}

/**
 * Writes one audit log row and queues the matching webhook deliveries. Call inside
 * the transaction performing the change.
 */
export async function recordAudit(tx: DbOrTx, entry: AuditEntry): Promise<void> {
  const [row] = await tx
    .insert(auditLog)
    .values({
      projectId: entry.projectId,
      environmentId: entry.environmentId ?? null,
      actorType: entry.actor.type,
      actorId: entry.actor.type === 'system' ? null : entry.actor.id,
      actorName: entry.actor.name,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityKey: entry.entityKey ?? null,
      before: (entry.before ?? null) as JsonValue,
      after: (entry.after ?? null) as JsonValue,
    })
    .returning({ id: auditLog.id, createdAt: auditLog.createdAt })
  if (row) await enqueueWebhookDeliveries(tx, { ...entry, id: row.id, createdAt: row.createdAt })
}
