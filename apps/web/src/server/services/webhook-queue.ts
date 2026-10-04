import type { JsonValue } from '@halyard/engine'
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '@/db'
import { environments, organization, webhookDeliveries, webhooks } from '@/db/schema'
import { publish } from '@/server/events'
import type { AuditEntry } from './audit'

/**
 * The JSON body of every webhook delivery. `id` is the id of the audit log entry
 * the event was created from (or a random id for test events) and is the same for
 * every webhook and every retry of the event.
 */
export interface WebhookEventPayload {
  id: string
  type: string
  createdAt: string
  project: { id: string; slug: string }
  environment: { id: string; key: string } | null
  actor: { type: 'user' | 'api_key' | 'system'; id: string | null; name: string }
  entity: { type: string; id: string; key: string | null }
  before: unknown
  after: unknown
}

/**
 * Whether a webhook subscribed to `patterns` receives `eventType`. A pattern is `*`
 * (everything), an exact event type such as `flag.toggled`, or a prefix pattern
 * such as `flag.*`.
 */
export function webhookMatchesEvent(patterns: readonly string[], eventType: string): boolean {
  return patterns.some((pattern) => {
    if (pattern === '*') return true
    if (pattern.endsWith('.*')) return eventType.startsWith(pattern.slice(0, -1))
    return pattern === eventType
  })
}

export async function projectRef(
  executor: DbOrTx,
  projectId: string,
): Promise<{ id: string; slug: string }> {
  const [row] = await executor
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, projectId))
  return { id: projectId, slug: row?.slug ?? '' }
}

/** Inserts pending deliveries and wakes the dispatchers (on commit when inside a transaction). */
export async function insertDeliveries(
  executor: DbOrTx,
  webhookIds: string[],
  payload: WebhookEventPayload,
): Promise<(typeof webhookDeliveries.$inferSelect)[]> {
  if (webhookIds.length === 0) return []
  const rows = await executor
    .insert(webhookDeliveries)
    .values(
      webhookIds.map((webhookId) => ({
        webhookId,
        eventType: payload.type,
        payload: payload as unknown as JsonValue,
        status: 'pending' as const,
        nextAttemptAt: new Date(),
      })),
    )
    .returning()
  await publish({ type: 'webhook.enqueued' }, executor)
  return rows
}

/**
 * Called by `recordAudit` for every audit row: queues one delivery per enabled
 * webhook of the project that subscribes to the action. Runs inside the caller's
 * transaction, so deliveries exist exactly when the change they describe commits.
 * Costs one indexed query when the project has no webhooks.
 */
export async function enqueueWebhookDeliveries(
  executor: DbOrTx,
  entry: AuditEntry & { id: string; createdAt: Date },
): Promise<void> {
  const hooks = await executor
    .select({ id: webhooks.id, events: webhooks.events })
    .from(webhooks)
    .where(and(eq(webhooks.projectId, entry.projectId), eq(webhooks.enabled, true)))
  const targets = hooks.filter((hook) => webhookMatchesEvent(hook.events, entry.action))
  if (targets.length === 0) return

  let environment: WebhookEventPayload['environment'] = null
  if (entry.environmentId) {
    const [env] = await executor
      .select({ id: environments.id, key: environments.key })
      .from(environments)
      .where(eq(environments.id, entry.environmentId))
    environment = env ?? null
  }

  await insertDeliveries(
    executor,
    targets.map((hook) => hook.id),
    {
      id: entry.id,
      type: entry.action,
      createdAt: entry.createdAt.toISOString(),
      project: await projectRef(executor, entry.projectId),
      environment,
      actor: {
        type: entry.actor.type,
        id: entry.actor.type === 'system' ? null : entry.actor.id,
        name: entry.actor.name,
      },
      entity: { type: entry.entityType, id: entry.entityId, key: entry.entityKey ?? null },
      before: entry.before ?? null,
      after: entry.after ?? null,
    },
  )
}
