import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { webhookDeliveries, webhooks } from '@/db/schema'
import { badRequest, conflict, notFound } from '@/server/errors'
import { publish } from '@/server/events'
import {
  type CreateWebhookInput,
  createWebhookSchema,
  type ListWebhookDeliveriesInput,
  listWebhookDeliveriesSchema,
  listWebhooksSchema,
  type RedeliverWebhookInput,
  redeliverWebhookSchema,
  type UpdateWebhookInput,
  updateWebhookSchema,
  type WebhookRefInput,
  webhookRefSchema,
} from '../schemas/webhooks'
import { recordAudit } from './audit'
import { assertPermission, assertProjectAccess, auditActor, type ProjectActor } from './authz'
import { jsonEqual, one, parseInput } from './util'
import { insertDeliveries, projectRef, type WebhookEventPayload } from './webhook-queue'
import { assertAllowedWebhookTarget } from './webhook-targets'

export { type WebhookEventPayload, webhookMatchesEvent } from './webhook-queue'

type WebhookRow = typeof webhooks.$inferSelect
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect

/** A webhook as returned to clients: the secret is reduced to a short preview. */
export interface Webhook extends Omit<WebhookRow, 'secret'> {
  secretPreview: string
  lastDelivery: {
    status: WebhookDelivery['status']
    eventType: string
    lastStatusCode: number | null
    createdAt: Date
  } | null
}

export interface WebhookWithSecret extends Webhook {
  /** The full signing secret. Only returned when a webhook is created or its secret rotated. */
  secret: string
}

export interface WebhookDeliveryPage {
  items: WebhookDelivery[]
  /** Pass as `cursor` to fetch the next page; null on the last page. */
  nextCursor: string | null
}

/** Event type of the deliveries created by {@link sendTestWebhook}. */
export const WEBHOOK_TEST_EVENT = 'webhook.test'

export interface WebhookEventType {
  type: string
  description: string
}

/**
 * Event types offered in the UI. Webhooks may also subscribe to `*`, any
 * `<category>.*` pattern or any other dotted audit action.
 */
export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  { type: '*', description: 'Every event' },
  { type: 'flag.*', description: 'Every flag event' },
  { type: 'flag.created', description: 'A flag was created' },
  { type: 'flag.updated', description: 'Name, description, tags or variants of a flag changed' },
  { type: 'flag.toggled', description: 'A flag was turned on or off in an environment' },
  {
    type: 'flag.environment_updated',
    description: 'Targeting, rules or fallthrough of a flag changed in an environment',
  },
  { type: 'flag.promoted', description: 'A configuration was copied between environments' },
  { type: 'flag.archived', description: 'A flag was archived' },
  { type: 'flag.unarchived', description: 'A flag was restored from the archive' },
  { type: 'flag.deleted', description: 'A flag was deleted' },
  { type: 'segment.*', description: 'A segment was created, updated or deleted' },
  { type: 'environment.*', description: 'An environment was created, updated or deleted' },
  { type: 'experiment.*', description: 'Every experiment event' },
  { type: 'schedule.*', description: 'Every scheduled change event' },
  { type: 'schedule.created', description: 'A change was scheduled' },
  { type: 'schedule.staged_rollout_created', description: 'A staged rollout was scheduled' },
  { type: 'schedule.updated', description: 'A scheduled change was edited' },
  { type: 'schedule.cancelled', description: 'A scheduled change was cancelled' },
  { type: 'schedule.plan_cancelled', description: 'A staged rollout was cancelled' },
  { type: 'schedule.executed', description: 'A scheduled change was applied' },
  { type: 'schedule.failed', description: 'A scheduled change could not be applied' },
  { type: 'member.*', description: 'Members were invited, joined, left, removed or changed role' },
  { type: 'api_key.*', description: 'An API key was created or deleted' },
  { type: 'project.*', description: 'Project settings changed' },
  { type: 'webhook.*', description: 'Webhooks were created, updated, deleted or rotated' },
]

export const generateWebhookSecret = (): string => randomBytes(32).toString('hex')

function hasPermission(actor: ProjectActor, permissions: Parameters<typeof assertPermission>[1]) {
  try {
    assertPermission(actor, permissions)
    return true
  } catch {
    return false
  }
}

const secretPreview = (secret: string) => `${secret.slice(0, 4)}…`

const auditSnapshot = (hook: WebhookRow) => ({
  name: hook.name,
  url: hook.url,
  events: hook.events,
  enabled: hook.enabled,
})

function toPublic(hook: WebhookRow, lastDelivery: Webhook['lastDelivery'] = null): Webhook {
  const { secret, ...rest } = hook
  return { ...rest, secretPreview: secretPreview(secret), lastDelivery }
}

async function lastDeliveries(webhookIds: string[]) {
  const byWebhook = new Map<string, NonNullable<Webhook['lastDelivery']>>()
  if (webhookIds.length === 0) return byWebhook
  const rows = await db
    .selectDistinctOn([webhookDeliveries.webhookId], {
      webhookId: webhookDeliveries.webhookId,
      status: webhookDeliveries.status,
      eventType: webhookDeliveries.eventType,
      lastStatusCode: webhookDeliveries.lastStatusCode,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.webhookId, webhookIds))
    .orderBy(webhookDeliveries.webhookId, desc(webhookDeliveries.createdAt))
  for (const { webhookId, ...delivery } of rows) byWebhook.set(webhookId, delivery)
  return byWebhook
}

async function findWebhook(
  executor: Pick<typeof db, 'select'>,
  projectId: string,
  webhookId: string,
  lock = false,
): Promise<WebhookRow> {
  const query = executor
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.projectId, projectId)))
  const [hook] = lock ? await query.for('update') : await query
  if (!hook) throw notFound('Webhook')
  return hook
}

export async function listWebhooks(
  actor: ProjectActor,
  input: { projectId: string },
): Promise<Webhook[]> {
  const { projectId } = parseInput(listWebhooksSchema, input)
  assertProjectAccess(actor, projectId, { webhook: ['read'] })
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.projectId, projectId))
    .orderBy(webhooks.createdAt, webhooks.id)
  const last = await lastDeliveries(rows.map((r) => r.id))
  return rows.map((row) => toPublic(row, last.get(row.id) ?? null))
}

export async function getWebhook(actor: ProjectActor, input: WebhookRefInput): Promise<Webhook> {
  const { projectId, webhookId } = parseInput(webhookRefSchema, input)
  assertProjectAccess(actor, projectId, { webhook: ['read'] })
  const hook = await findWebhook(db, projectId, webhookId)
  const last = await lastDeliveries([hook.id])
  return toPublic(hook, last.get(hook.id) ?? null)
}

/** Creates a webhook. The response is the only place the full secret is returned. */
export async function createWebhook(
  actor: ProjectActor,
  input: CreateWebhookInput,
): Promise<WebhookWithSecret> {
  const data = parseInput(createWebhookSchema, input)
  assertProjectAccess(actor, data.projectId, { webhook: ['create'] })
  // No-op unless WEBHOOK_BLOCK_PRIVATE_NETWORKS is on; resolved outside the transaction.
  await assertAllowedWebhookTarget(data.url)

  return db.transaction(async (tx) => {
    const hook = one(
      await tx
        .insert(webhooks)
        .values({
          projectId: data.projectId,
          name: data.name,
          url: data.url,
          events: data.events,
          secret: data.secret ?? generateWebhookSecret(),
        })
        .returning(),
    )
    await recordAudit(tx, {
      projectId: data.projectId,
      actor: auditActor(actor),
      action: 'webhook.created',
      entityType: 'webhook',
      entityId: hook.id,
      entityKey: hook.name,
      after: auditSnapshot(hook),
    })
    return { ...toPublic(hook), secret: hook.secret }
  })
}

/**
 * Updates name, URL, events and the enabled flag. Disabling a webhook fails its
 * pending deliveries, so re-enabling it does not replay a backlog of old events.
 */
export async function updateWebhook(
  actor: ProjectActor,
  input: UpdateWebhookInput,
): Promise<Webhook> {
  const { projectId, webhookId, patch } = parseInput(updateWebhookSchema, input)
  assertProjectAccess(actor, projectId, { webhook: ['update'] })
  if (patch.url) await assertAllowedWebhookTarget(patch.url)

  return db.transaction(async (tx) => {
    const before = await findWebhook(tx, projectId, webhookId, true)
    const next = {
      name: patch.name ?? before.name,
      url: patch.url ?? before.url,
      events: patch.events ?? before.events,
      enabled: patch.enabled ?? before.enabled,
    }
    if (jsonEqual(next, auditSnapshot(before))) return toPublic(before)

    const after = one(
      await tx.update(webhooks).set(next).where(eq(webhooks.id, before.id)).returning(),
    )
    if (before.enabled && !after.enabled) {
      await tx
        .update(webhookDeliveries)
        .set({ status: 'failed', lastError: 'Webhook disabled' })
        .where(
          and(eq(webhookDeliveries.webhookId, after.id), eq(webhookDeliveries.status, 'pending')),
        )
    }
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'webhook.updated',
      entityType: 'webhook',
      entityId: after.id,
      entityKey: after.name,
      before: auditSnapshot(before),
      after: auditSnapshot(after),
    })
    return toPublic(after)
  })
}

/** Replaces the signing secret and returns the new one. */
export async function rotateSecret(
  actor: ProjectActor,
  input: WebhookRefInput,
): Promise<{ webhookId: string; secret: string }> {
  const { projectId, webhookId } = parseInput(webhookRefSchema, input)
  assertProjectAccess(actor, projectId, { webhook: ['update'] })

  return db.transaction(async (tx) => {
    const hook = await findWebhook(tx, projectId, webhookId, true)
    const secret = generateWebhookSecret()
    await tx.update(webhooks).set({ secret }).where(eq(webhooks.id, hook.id))
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'webhook.secret_rotated',
      entityType: 'webhook',
      entityId: hook.id,
      entityKey: hook.name,
    })
    return { webhookId: hook.id, secret }
  })
}

export async function deleteWebhook(
  actor: ProjectActor,
  input: WebhookRefInput,
): Promise<{ id: string; name: string }> {
  const { projectId, webhookId } = parseInput(webhookRefSchema, input)
  assertProjectAccess(actor, projectId, { webhook: ['delete'] })

  return db.transaction(async (tx) => {
    const hook = await findWebhook(tx, projectId, webhookId, true)
    await tx.delete(webhooks).where(eq(webhooks.id, hook.id))
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'webhook.deleted',
      entityType: 'webhook',
      entityId: hook.id,
      entityKey: hook.name,
      before: auditSnapshot(hook),
    })
    return { id: hook.id, name: hook.name }
  })
}

interface DeliveryCursor {
  /** Postgres text rendering of `created_at`, which keeps microsecond precision. */
  createdAt: string
  id: string
}

const encodeCursor = (cursor: DeliveryCursor) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url')

function decodeCursor(raw: string): DeliveryCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<DeliveryCursor>
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id }
    }
  } catch {
    // fall through
  }
  throw badRequest('Invalid cursor')
}

/** Deliveries of one webhook, newest first, keyset-paginated on `(created_at, id)`. */
export async function listDeliveries(
  actor: ProjectActor,
  input: ListWebhookDeliveriesInput,
): Promise<WebhookDeliveryPage> {
  const query = parseInput(listWebhookDeliveriesSchema, input)
  assertProjectAccess(actor, query.projectId, { webhook: ['read'] })
  await findWebhook(db, query.projectId, query.webhookId)
  const canManage = hasPermission(actor, { webhook: ['update'] })

  const limit = query.limit ?? 50
  const conditions = [eq(webhookDeliveries.webhookId, query.webhookId)]
  if (query.cursor) {
    const c = decodeCursor(query.cursor)
    conditions.push(
      sql`(${webhookDeliveries.createdAt}, ${webhookDeliveries.id}) < (${c.createdAt}::timestamptz, ${c.id}::uuid)`,
    )
  }
  const rows = await db
    .select({
      delivery: webhookDeliveries,
      cursorTs: sql<string>`${webhookDeliveries.createdAt}::text`,
    })
    .from(webhookDeliveries)
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    // Response bodies come from the receiving server and may be sensitive: owners only.
    items: page.map((r) => (canManage ? r.delivery : { ...r.delivery, lastResponseBody: null })),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.cursorTs, id: last.delivery.id })
        : null,
  }
}

/**
 * Queues a delivery again: attempts are reset and it is sent on the next dispatcher
 * run. A delivery that is in flight right now loses its lease, so the result of
 * that attempt is discarded and the delivery is sent once more.
 */
export async function redeliver(
  actor: ProjectActor,
  input: RedeliverWebhookInput,
): Promise<WebhookDelivery> {
  const { projectId, deliveryId } = parseInput(redeliverWebhookSchema, input)
  assertProjectAccess(actor, projectId, { webhook: ['update'] })

  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ delivery: webhookDeliveries, enabled: webhooks.enabled })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhooks.projectId, projectId)))
      .for('update', { of: webhookDeliveries })
    if (!found) throw notFound('Delivery')
    if (!found.enabled) throw conflict('Enable the webhook before redelivering')
    const updated = one(
      await tx
        .update(webhookDeliveries)
        .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), deliveredAt: null })
        .where(eq(webhookDeliveries.id, deliveryId))
        .returning(),
    )
    await publish({ type: 'webhook.enqueued' }, tx)
    return updated
  })
}

/** Queues a `webhook.test` event for one webhook, regardless of its event subscriptions. */
export async function sendTestWebhook(
  actor: ProjectActor,
  input: WebhookRefInput,
): Promise<WebhookDelivery> {
  const { projectId, webhookId } = parseInput(webhookRefSchema, input)
  assertProjectAccess(actor, projectId, { webhook: ['update'] })

  return db.transaction(async (tx) => {
    const hook = await findWebhook(tx, projectId, webhookId)
    if (!hook.enabled) throw conflict('Enable the webhook before sending a test event')
    const actorRef = auditActor(actor)
    const payload: WebhookEventPayload = {
      id: crypto.randomUUID(),
      type: WEBHOOK_TEST_EVENT,
      createdAt: new Date().toISOString(),
      project: await projectRef(tx, projectId),
      environment: null,
      actor: {
        type: actorRef.type,
        id: actorRef.type === 'system' ? null : actorRef.id,
        name: actorRef.name,
      },
      entity: { type: 'webhook', id: hook.id, key: hook.name },
      before: null,
      after: { message: 'This is a test event sent from Halyard.' },
    }
    return one(await insertDeliveries(tx, [hook.id], payload))
  })
}

// Signatures -------------------------------------------------------------------

/** Hex HMAC-SHA256 of `${timestamp}.${rawBody}` with the webhook secret. */
export function computeWebhookSignature(
  secret: string,
  timestamp: number,
  rawBody: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

/** The `X-Halyard-Signature` header value: `t=<unix seconds>,v1=<hex signature>`. */
export function signatureHeader(secret: string, timestamp: number, rawBody: string): string {
  return `t=${timestamp},v1=${computeWebhookSignature(secret, timestamp, rawBody)}`
}

/**
 * Verifies an `X-Halyard-Signature` header against the raw request body. Returns
 * false when the header is malformed, the timestamp is further than
 * `toleranceSeconds` from `now`, or no `v1` signature matches. Comparison is
 * constant-time.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  options: { toleranceSeconds?: number; now?: Date | number } = {},
): boolean {
  if (!header) return false
  const toleranceSeconds = options.toleranceSeconds ?? 300
  const nowMs = options.now === undefined ? Date.now() : new Date(options.now).getTime()

  let timestamp: number | undefined
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value)
    else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase())
  }
  if (timestamp === undefined || signatures.length === 0) return false
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) return false

  const expected = Buffer.from(computeWebhookSignature(secret, timestamp, rawBody), 'hex')
  let valid = false
  for (const signature of signatures) {
    const candidate = Buffer.from(signature, 'hex')
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) valid = true
  }
  return valid
}
