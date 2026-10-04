import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, webhookDeliveries, webhooks } from '@/db/schema'
import { recordAudit } from '@/server/services/audit'
import { createFlag, toggleFlag } from '@/server/services/flags'
import { createScheduledChange } from '@/server/services/scheduled-changes'
import { createSegment } from '@/server/services/segments'
import { PRIVATE_TARGET_ERROR } from '@/server/services/webhook-targets'
import {
  computeWebhookSignature,
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listWebhooks,
  redeliver,
  rotateSecret,
  sendTestWebhook,
  updateWebhook,
  verifyWebhookSignature,
  WEBHOOK_EVENT_TYPES,
  type WebhookEventPayload,
  webhookMatchesEvent,
} from '@/server/services/webhooks'
import { runDueScheduledChanges } from '@/server/workers/scheduler'
import {
  BASE_BACKOFF_MS,
  backoffMs,
  deliverPendingWebhooks,
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  MAX_RESPONSE_BODY_BYTES,
  postWebhook,
  startWebhookDispatcher,
  stopWebhookDispatcher,
} from '@/server/workers/webhook-dispatcher'
import { captureEvents, createProjectFixture, type ProjectFixture } from './factories'
import { resetDatabase } from './helpers'

// Test receiver ----------------------------------------------------------------

interface ReceivedRequest {
  method: string
  path: string
  headers: IncomingHttpHeaders
  body: string
}

interface Reply {
  status?: number
  body?: string
  /** Never answer (to provoke a timeout). */
  hang?: boolean
  delayMs?: number
}

interface Receiver {
  url: string
  requests: ReceivedRequest[]
  reply: (handler: (request: ReceivedRequest, index: number) => Reply) => void
  close: () => Promise<void>
}

const servers: Server[] = []

/** A real HTTP server on a random port that records every request. */
async function startReceiver(): Promise<Receiver> {
  const requests: ReceivedRequest[] = []
  let handler: (request: ReceivedRequest, index: number) => Reply = () => ({
    status: 200,
    body: 'ok',
  })
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const request: ReceivedRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(request)
      const reply = handler(request, requests.length - 1)
      if (reply.hang) return
      const send = () => {
        res.writeHead(reply.status ?? 200, { 'Content-Type': 'text/plain' })
        res.end(reply.body ?? '')
      }
      if (reply.delayMs) setTimeout(send, reply.delayMs)
      else send()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/hooks/halyard`,
    requests,
    reply: (next) => {
      handler = next
    },
    close: () => closeServer(server),
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })
}

// Fixture ----------------------------------------------------------------------

let fx: ProjectFixture
let events: ReturnType<typeof captureEvents>

beforeEach(async () => {
  await resetDatabase()
  fx = await createProjectFixture()
  events = captureEvents()
})

afterEach(async () => {
  events.stop()
  await Promise.all(servers.splice(0).map(closeServer))
})

const owner = () => fx.owner.actor
const projectId = () => fx.projectId
const SECOND = 1000

const newWebhook = (overrides: Partial<Parameters<typeof createWebhook>[1]> = {}) =>
  createWebhook(owner(), {
    projectId: projectId(),
    name: 'Deploy bot',
    url: 'https://hooks.example.com/halyard',
    events: ['*'],
    ...overrides,
  })

const newFlag = (key = 'checkout') =>
  createFlag(owner(), { projectId: projectId(), key, name: `Flag ${key}`, type: 'boolean' })

const toggle = (enabled = true, key = 'checkout', environmentKey = 'production') =>
  toggleFlag(owner(), { projectId: projectId(), flagKey: key, environmentKey, enabled })

const deliveries = () => db.select().from(webhookDeliveries).orderBy(webhookDeliveries.createdAt)

async function deliveryOf(id: string) {
  const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id))
  if (!row) throw new Error('delivery not found')
  return row
}

/** Creates a webhook pointing at a receiver plus one pending `webhook.test` delivery. */
async function hookWithDelivery(receiver: Receiver) {
  const hook = await newWebhook({ url: receiver.url, events: ['segment.*'] })
  const delivery = await sendTestWebhook(owner(), { projectId: projectId(), webhookId: hook.id })
  return { hook, delivery }
}

// Tests ------------------------------------------------------------------------

describe('webhook CRUD', () => {
  it('creates a webhook and returns the generated secret only once', async () => {
    const created = await newWebhook({ events: ['flag.*', 'segment.created', 'flag.*'] })
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(created).toMatchObject({
      name: 'Deploy bot',
      url: 'https://hooks.example.com/halyard',
      events: ['flag.*', 'segment.created'],
      enabled: true,
      secretPreview: `${created.secret.slice(0, 4)}…`,
    })

    const listed = await listWebhooks(fx.viewer.actor, { projectId: projectId() })
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty('secret')
    expect(JSON.stringify(listed)).not.toContain(created.secret)
    const fetched = await getWebhook(fx.viewer.actor, {
      projectId: projectId(),
      webhookId: created.id,
    })
    expect(fetched).not.toHaveProperty('secret')
    expect(fetched).toMatchObject({ id: created.id, secretPreview: created.secretPreview })

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'webhook.created'))
    expect(audit).toMatchObject({ entityType: 'webhook', entityId: created.id })
    expect(JSON.stringify(audit)).not.toContain(created.secret)
  })

  it('keeps a provided secret', async () => {
    const created = await newWebhook({ secret: 'my-own-secret-value-123' })
    expect(created.secret).toBe('my-own-secret-value-123')
    expect(created.secretPreview).toBe('my-o…')
  })

  it('validates url, events and secret', async () => {
    await expect(newWebhook({ url: 'ftp://example.com/hook' })).rejects.toMatchObject({
      status: 400,
    })
    await expect(newWebhook({ url: 'not a url' })).rejects.toMatchObject({ status: 400 })
    await expect(newWebhook({ events: [] })).rejects.toMatchObject({ status: 400 })
    await expect(newWebhook({ events: ['flag'] })).rejects.toMatchObject({ status: 400 })
    await expect(newWebhook({ events: ['Flag.Updated'] })).rejects.toMatchObject({ status: 400 })
    await expect(newWebhook({ secret: 'short' })).rejects.toMatchObject({ status: 400 })
    // Internal hosts are allowed: self-hosted installations call internal services.
    await expect(newWebhook({ url: 'http://10.0.0.5:8080/hook' })).resolves.toMatchObject({
      url: 'http://10.0.0.5:8080/hook',
    })
  })

  it('updates, rotates the secret and deletes', async () => {
    const created = await newWebhook()
    const updated = await updateWebhook(owner(), {
      projectId: projectId(),
      webhookId: created.id,
      patch: { name: 'Renamed', events: ['flag.toggled'], enabled: false },
    })
    expect(updated).toMatchObject({ name: 'Renamed', events: ['flag.toggled'], enabled: false })
    expect(updated).not.toHaveProperty('secret')

    // Unchanged patches are not written.
    await updateWebhook(owner(), {
      projectId: projectId(),
      webhookId: created.id,
      patch: { name: 'Renamed' },
    })
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, 'webhook.updated')),
    ).toHaveLength(1)

    const rotated = await rotateSecret(owner(), { projectId: projectId(), webhookId: created.id })
    expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(rotated.secret).not.toBe(created.secret)
    const [stored] = await db.select().from(webhooks).where(eq(webhooks.id, created.id))
    expect(stored?.secret).toBe(rotated.secret)
    const audits = await db.select().from(auditLog)
    expect(audits.map((a) => a.action)).toContain('webhook.secret_rotated')
    expect(JSON.stringify(audits)).not.toContain(rotated.secret)
    expect(JSON.stringify(audits)).not.toContain(created.secret)

    await deleteWebhook(owner(), { projectId: projectId(), webhookId: created.id })
    expect(await listWebhooks(owner(), { projectId: projectId() })).toEqual([])
    await expect(
      getWebhook(owner(), { projectId: projectId(), webhookId: created.id }),
    ).rejects.toMatchObject({ status: 404 })
    expect(audits.length + 1).toBe((await db.select().from(auditLog)).length)
  })

  it('lets only owners manage webhooks and viewers read them', async () => {
    const created = await newWebhook()
    const ref = { projectId: projectId(), webhookId: created.id }
    for (const actor of [fx.editor.actor, fx.viewer.actor]) {
      await expect(
        createWebhook(actor, {
          projectId: projectId(),
          name: 'x',
          url: 'https://example.com',
          events: ['*'],
        }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(updateWebhook(actor, { ...ref, patch: { name: 'x' } })).rejects.toMatchObject({
        status: 403,
      })
      await expect(rotateSecret(actor, ref)).rejects.toMatchObject({ status: 403 })
      await expect(deleteWebhook(actor, ref)).rejects.toMatchObject({ status: 403 })
      await expect(sendTestWebhook(actor, ref)).rejects.toMatchObject({ status: 403 })
    }
    await expect(listWebhooks(fx.viewer.actor, { projectId: projectId() })).resolves.toHaveLength(1)
    await expect(
      listWebhooks({ ...owner(), projectId: 'another-project' }, { projectId: projectId() }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('does not expose webhooks of other projects', async () => {
    const other = await createProjectFixture('other')
    const created = await newWebhook()
    await expect(
      getWebhook(other.owner.actor, { projectId: other.projectId, webhookId: created.id }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      deleteWebhook(other.owner.actor, { projectId: other.projectId, webhookId: created.id }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('offers a curated list of event types', () => {
    const types = WEBHOOK_EVENT_TYPES.map((t) => t.type)
    expect(types).toEqual(expect.arrayContaining(['*', 'flag.*', 'flag.toggled', 'schedule.*']))
    for (const type of WEBHOOK_EVENT_TYPES) expect(type.description).not.toBe('')
  })
})

describe('event matching', () => {
  it('matches *, prefix patterns and exact types', () => {
    expect(webhookMatchesEvent(['*'], 'flag.toggled')).toBe(true)
    expect(webhookMatchesEvent(['flag.*'], 'flag.toggled')).toBe(true)
    expect(webhookMatchesEvent(['flag.*'], 'flags.toggled')).toBe(false)
    expect(webhookMatchesEvent(['flag.*'], 'segment.created')).toBe(false)
    expect(webhookMatchesEvent(['flag.toggled'], 'flag.toggled')).toBe(true)
    expect(webhookMatchesEvent(['flag.toggled'], 'flag.created')).toBe(false)
    expect(webhookMatchesEvent(['segment.created', 'flag.toggled'], 'flag.toggled')).toBe(true)
    expect(webhookMatchesEvent([], 'flag.toggled')).toBe(false)
  })
})

describe('enqueueing on recordAudit', () => {
  it('queues a delivery for each enabled webhook subscribed to the action', async () => {
    await newFlag()
    const flags = await newWebhook({ name: 'flags', events: ['flag.*'] })
    const exact = await newWebhook({ name: 'exact', events: ['flag.toggled'] })
    const all = await newWebhook({ name: 'all', events: ['*'] })
    await newWebhook({ name: 'segments', events: ['segment.*'] })
    await newWebhook({ name: 'created', events: ['flag.created'] })
    const disabled = await newWebhook({ name: 'disabled', events: ['*'] })
    await updateWebhook(owner(), {
      projectId: projectId(),
      webhookId: disabled.id,
      patch: { enabled: false },
    })
    await db.delete(webhookDeliveries)
    events.clear()

    await toggle(true)

    const rows = await deliveries()
    expect(rows.map((r) => r.webhookId).sort()).toEqual([flags.id, exact.id, all.id].sort())
    for (const row of rows) {
      expect(row).toMatchObject({
        eventType: 'flag.toggled',
        status: 'pending',
        attempts: 0,
        lastStatusCode: null,
        deliveredAt: null,
      })
      expect(row.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now())
    }
    expect(events.events).toContainEqual({ type: 'webhook.enqueued' })

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'flag.toggled'))
    const payload = rows[0]?.payload as unknown as WebhookEventPayload
    expect(payload).toEqual({
      id: audit?.id,
      type: 'flag.toggled',
      createdAt: audit?.createdAt.toISOString(),
      project: { id: projectId(), slug: 'acme' },
      environment: { id: fx.environmentId('production'), key: 'production' },
      actor: { type: 'user', id: fx.owner.user.id, name: 'Olivia Owner' },
      entity: { type: 'flag', id: audit?.entityId, key: 'checkout' },
      before: expect.objectContaining({ enabled: false }),
      after: expect.objectContaining({ enabled: true }),
    })
    // Every webhook receives the same event.
    expect(new Set(rows.map((r) => JSON.stringify(r.payload))).size).toBe(1)
  })

  it('writes nothing when the project has no matching webhook', async () => {
    await newFlag()
    await newWebhook({ events: ['segment.*'] })
    await db.delete(webhookDeliveries)
    events.clear()
    await toggle(true)
    expect(await deliveries()).toEqual([])
    expect(events.events).not.toContainEqual({ type: 'webhook.enqueued' })
  })

  it('does not deliver events of other projects', async () => {
    const other = await createProjectFixture('other')
    await newWebhook({ events: ['*'] })
    await db.delete(webhookDeliveries)
    await createSegment(other.owner.actor, {
      projectId: other.projectId,
      key: 'beta',
      name: 'Beta',
      conditions: [],
    })
    expect(await deliveries()).toEqual([])
  })

  it('rolls back deliveries with the change that caused them', async () => {
    await newWebhook({ events: ['*'] })
    await db.delete(webhookDeliveries)
    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, {
          projectId: projectId(),
          actor: { type: 'user', id: fx.owner.user.id, name: 'Olivia Owner' },
          action: 'flag.updated',
          entityType: 'flag',
          entityId: 'x',
        })
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await deliveries()).toEqual([])
  })

  it('identifies the scheduler as a system actor', async () => {
    await newFlag()
    await createScheduledChange(owner(), {
      projectId: projectId(),
      flagKey: 'checkout',
      environmentKey: 'production',
      scheduledFor: new Date(Date.now() + 60 * SECOND),
      change: { enabled: true },
    })
    await newWebhook({ events: ['flag.toggled', 'schedule.executed'] })
    await runDueScheduledChanges(new Date(Date.now() + 120 * SECOND))
    const rows = await deliveries()
    expect(rows.map((r) => r.eventType).sort()).toEqual(['flag.toggled', 'schedule.executed'])
    for (const row of rows) {
      expect((row.payload as unknown as WebhookEventPayload).actor).toEqual({
        type: 'system',
        id: null,
        name: 'Scheduler',
      })
    }
  })
})

describe('deliverPendingWebhooks', () => {
  it('posts the event with signed headers and records the success', async () => {
    const receiver = await startReceiver()
    await newFlag()
    const hook = await newWebhook({ url: receiver.url, events: ['flag.toggled'] })
    await toggle(true)
    const [pending] = await deliveries()
    if (!pending) throw new Error('no delivery')

    expect(await deliverPendingWebhooks()).toEqual({ delivered: 1, retrying: 0, failed: 0 })
    expect(receiver.requests).toHaveLength(1)
    const request = receiver.requests[0] as ReceivedRequest
    expect(request.method).toBe('POST')
    expect(request.path).toBe('/hooks/halyard')
    expect(request.headers).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'Halyard-Webhooks/1',
      'x-halyard-event': 'flag.toggled',
      'x-halyard-delivery': pending.id,
    })
    expect(JSON.parse(request.body)).toEqual(pending.payload)

    const timestamp = Number(request.headers['x-halyard-timestamp'])
    expect(Math.abs(timestamp - Date.now() / 1000)).toBeLessThan(5)
    const signature = request.headers['x-halyard-signature'] as string
    expect(signature).toBe(
      `t=${timestamp},v1=${computeWebhookSignature(hook.secret, timestamp, request.body)}`,
    )
    expect(verifyWebhookSignature(hook.secret, signature, request.body)).toBe(true)
    expect(verifyWebhookSignature('wrong-secret', signature, request.body)).toBe(false)
    expect(verifyWebhookSignature(hook.secret, signature, `${request.body} `)).toBe(false)
    expect(
      verifyWebhookSignature(hook.secret, signature, request.body, {
        now: (timestamp + 301) * 1000,
      }),
    ).toBe(false)
    expect(
      verifyWebhookSignature(hook.secret, signature, request.body, {
        now: (timestamp + 301) * 1000,
        toleranceSeconds: 600,
      }),
    ).toBe(true)

    const row = await deliveryOf(pending.id)
    expect(row).toMatchObject({
      status: 'success',
      attempts: 1,
      lastStatusCode: 200,
      lastError: null,
      lastResponseBody: 'ok',
    })
    expect(row.deliveredAt).toBeInstanceOf(Date)

    // Delivered rows are not sent again.
    expect(await deliverPendingWebhooks()).toEqual({ delivered: 0, retrying: 0, failed: 0 })
    expect(receiver.requests).toHaveLength(1)
  })

  it('truncates stored response bodies', async () => {
    const receiver = await startReceiver()
    receiver.reply(() => ({ status: 200, body: 'é'.repeat(5000) }))
    const { delivery } = await hookWithDelivery(receiver)
    await deliverPendingWebhooks()
    const row = await deliveryOf(delivery.id)
    expect(Buffer.byteLength(row.lastResponseBody ?? '')).toBeLessThanOrEqual(
      MAX_RESPONSE_BODY_BYTES,
    )
    expect(row.lastResponseBody).toMatch(/^é+$/)
  })

  it('schedules a retry with exponential backoff after an error response', async () => {
    const receiver = await startReceiver()
    receiver.reply(() => ({ status: 500, body: 'boom' }))
    const { delivery } = await hookWithDelivery(receiver)

    const now = new Date()
    expect(await deliverPendingWebhooks(now)).toEqual({ delivered: 0, retrying: 1, failed: 0 })
    let row = await deliveryOf(delivery.id)
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatusCode: 500,
      lastError: 'HTTP 500',
      lastResponseBody: 'boom',
      deliveredAt: null,
    })
    const firstDelay = row.nextAttemptAt.getTime() - now.getTime()
    expect(firstDelay).toBeGreaterThanOrEqual(2 * BASE_BACKOFF_MS * 0.9)
    expect(firstDelay).toBeLessThanOrEqual(2 * BASE_BACKOFF_MS * 1.1 + 5 * SECOND)

    // Not due yet.
    expect(await deliverPendingWebhooks(now)).toEqual({ delivered: 0, retrying: 0, failed: 0 })
    expect(receiver.requests).toHaveLength(1)

    const second = row.nextAttemptAt
    await deliverPendingWebhooks(second)
    row = await deliveryOf(delivery.id)
    expect(row.attempts).toBe(2)
    const secondDelay = row.nextAttemptAt.getTime() - second.getTime()
    expect(secondDelay).toBeGreaterThanOrEqual(4 * BASE_BACKOFF_MS * 0.9)
    expect(secondDelay).toBeLessThanOrEqual(4 * BASE_BACKOFF_MS * 1.1 + 5 * SECOND)

    // The receiver recovers.
    receiver.reply(() => ({ status: 204 }))
    expect(await deliverPendingWebhooks(row.nextAttemptAt)).toEqual({
      delivered: 1,
      retrying: 0,
      failed: 0,
    })
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'success',
      attempts: 3,
      lastStatusCode: 204,
      lastError: null,
    })
  })

  it('treats a timeout as a failed attempt', async () => {
    const receiver = await startReceiver()
    receiver.reply(() => ({ hang: true }))
    const { delivery } = await hookWithDelivery(receiver)
    const started = Date.now()
    expect(await deliverPendingWebhooks(new Date(), { timeoutMs: 200 })).toEqual({
      delivered: 0,
      retrying: 1,
      failed: 0,
    })
    expect(Date.now() - started).toBeLessThan(5 * SECOND)
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatusCode: null,
      lastError: expect.stringMatching(/Timed out/),
    })
  })

  it('treats connection errors and redirects as failed attempts', async () => {
    const receiver = await startReceiver()
    receiver.reply(() => ({ status: 302 }))
    const { delivery } = await hookWithDelivery(receiver)
    await deliverPendingWebhooks()
    expect(await deliveryOf(delivery.id)).toMatchObject({ attempts: 1, lastStatusCode: 302 })

    await receiver.close()
    await deliverPendingWebhooks(new Date(Date.now() + 10 * 60 * SECOND))
    const row = await deliveryOf(delivery.id)
    expect(row).toMatchObject({ status: 'pending', attempts: 2, lastStatusCode: null })
    expect(row.lastError).toBeTruthy()
  })

  it(`gives up after ${MAX_ATTEMPTS} attempts and can be redelivered`, async () => {
    const receiver = await startReceiver()
    receiver.reply(() => ({ status: 503 }))
    const { delivery } = await hookWithDelivery(receiver)

    let clock = new Date()
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const result = await deliverPendingWebhooks(clock)
      expect(result).toEqual(
        attempt < MAX_ATTEMPTS
          ? { delivered: 0, retrying: 1, failed: 0 }
          : { delivered: 0, retrying: 0, failed: 1 },
      )
      clock = (await deliveryOf(delivery.id)).nextAttemptAt
    }
    expect(receiver.requests).toHaveLength(MAX_ATTEMPTS)
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      lastStatusCode: 503,
    })
    expect(await deliverPendingWebhooks(new Date(Date.now() + 365 * 86_400_000))).toEqual({
      delivered: 0,
      retrying: 0,
      failed: 0,
    })

    await expect(
      redeliver(fx.viewer.actor, { projectId: projectId(), deliveryId: delivery.id }),
    ).rejects.toMatchObject({ status: 403 })
    events.clear()
    const requeued = await redeliver(owner(), { projectId: projectId(), deliveryId: delivery.id })
    expect(requeued).toMatchObject({ status: 'pending', attempts: 0 })
    expect(requeued.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now())
    expect(events.events).toContainEqual({ type: 'webhook.enqueued' })

    receiver.reply(() => ({ status: 200 }))
    expect(await deliverPendingWebhooks()).toEqual({ delivered: 1, retrying: 0, failed: 0 })
    expect(await deliveryOf(delivery.id)).toMatchObject({ status: 'success', attempts: 1 })
  })

  it('does not redeliver deliveries of other projects', async () => {
    const receiver = await startReceiver()
    const { delivery } = await hookWithDelivery(receiver)
    const other = await createProjectFixture('other')
    await expect(
      redeliver(other.owner.actor, { projectId: other.projectId, deliveryId: delivery.id }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('sends each delivery once when dispatchers run concurrently', async () => {
    const receiver = await startReceiver()
    receiver.reply(() => ({ status: 200, delayMs: 50 }))
    const hook = await newWebhook({ url: receiver.url, events: ['segment.*'] })
    for (let i = 0; i < 15; i += 1) {
      await sendTestWebhook(owner(), { projectId: projectId(), webhookId: hook.id })
    }
    // Open pooled connections first so both dispatchers really claim at the same time.
    await Promise.all(Array.from({ length: 6 }, () => db.execute(sql`select pg_sleep(0.05)`)))

    const now = new Date()
    const results = await Promise.all([deliverPendingWebhooks(now), deliverPendingWebhooks(now)])
    expect(results.reduce((sum, r) => sum + r.delivered, 0)).toBe(15)
    expect(receiver.requests).toHaveLength(15)
    expect(new Set(receiver.requests.map((r) => r.headers['x-halyard-delivery'])).size).toBe(15)
    const rows = await deliveries()
    expect(rows.every((r) => r.status === 'success' && r.attempts === 1)).toBe(true)
  })

  it('discards the result of an attempt whose lease was taken over by a redelivery', async () => {
    const receiver = await startReceiver()
    const { delivery } = await hookWithDelivery(receiver)
    receiver.reply(() => ({ status: 500, delayMs: 300 }))
    const inFlight = deliverPendingWebhooks()
    await new Promise((r) => setTimeout(r, 100))
    await redeliver(owner(), { projectId: projectId(), deliveryId: delivery.id })
    expect(await inFlight).toEqual({ delivered: 0, retrying: 0, failed: 0 })
    expect(await deliveryOf(delivery.id)).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('stops delivering when a webhook is disabled', async () => {
    const receiver = await startReceiver()
    const { hook, delivery } = await hookWithDelivery(receiver)
    await updateWebhook(owner(), {
      projectId: projectId(),
      webhookId: hook.id,
      patch: { enabled: false },
    })
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'failed',
      lastError: 'Webhook disabled',
    })
    expect(await deliverPendingWebhooks()).toEqual({ delivered: 0, retrying: 0, failed: 0 })
    expect(receiver.requests).toHaveLength(0)
    await expect(
      sendTestWebhook(owner(), { projectId: projectId(), webhookId: hook.id }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('sendTestWebhook', () => {
  it('queues a webhook.test event regardless of subscriptions', async () => {
    const receiver = await startReceiver()
    const hook = await newWebhook({ url: receiver.url, events: ['segment.created'] })
    events.clear()
    const delivery = await sendTestWebhook(owner(), { projectId: projectId(), webhookId: hook.id })
    expect(delivery).toMatchObject({
      webhookId: hook.id,
      eventType: 'webhook.test',
      status: 'pending',
    })
    expect(delivery.payload).toMatchObject({
      type: 'webhook.test',
      project: { id: projectId(), slug: 'acme' },
      environment: null,
      actor: { type: 'user', id: fx.owner.user.id, name: 'Olivia Owner' },
      entity: { type: 'webhook', id: hook.id, key: 'Deploy bot' },
    })
    expect(events.events).toContainEqual({ type: 'webhook.enqueued' })

    await deliverPendingWebhooks()
    expect(receiver.requests[0]?.headers['x-halyard-event']).toBe('webhook.test')
    expect(
      verifyWebhookSignature(
        hook.secret,
        receiver.requests[0]?.headers['x-halyard-signature'] as string,
        receiver.requests[0]?.body ?? '',
      ),
    ).toBe(true)
  })
})

describe('listDeliveries', () => {
  it('pages through deliveries newest first', async () => {
    const hook = await newWebhook({ events: ['segment.*'] })
    const ids: string[] = []
    for (let i = 0; i < 5; i += 1) {
      ids.push((await sendTestWebhook(owner(), { projectId: projectId(), webhookId: hook.id })).id)
    }
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await listDeliveries(fx.viewer.actor, {
        projectId: projectId(),
        webhookId: hook.id,
        limit: 2,
        cursor,
      })
      seen.push(...page.items.map((d) => d.id))
      cursor = page.nextCursor ?? undefined
      pages += 1
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toEqual([...ids].reverse())

    await expect(
      listDeliveries(owner(), { projectId: projectId(), webhookId: hook.id, cursor: 'garbage' }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      listDeliveries(owner(), { projectId: projectId(), webhookId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('shows the last delivery in the webhook list', async () => {
    const hook = await newWebhook({ events: ['segment.*'] })
    await sendTestWebhook(owner(), { projectId: projectId(), webhookId: hook.id })
    const [listed] = await listWebhooks(owner(), { projectId: projectId() })
    expect(listed?.lastDelivery).toMatchObject({ status: 'pending', eventType: 'webhook.test' })
  })
})

describe('backoff and signatures', () => {
  it('doubles the delay per attempt up to six hours', () => {
    expect(backoffMs(1)).toBe(60_000)
    expect(backoffMs(2)).toBe(120_000)
    expect(backoffMs(7)).toBe(128 * 30_000)
    expect(backoffMs(20)).toBe(MAX_BACKOFF_MS)
  })

  it('rejects malformed signature headers', () => {
    const body = '{"a":1}'
    const t = Math.floor(Date.now() / 1000)
    const valid = `t=${t},v1=${computeWebhookSignature('secret', t, body)}`
    expect(verifyWebhookSignature('secret', valid, body)).toBe(true)
    expect(
      verifyWebhookSignature('secret', `v1=${computeWebhookSignature('secret', t, body)}`, body),
    ).toBe(false)
    expect(verifyWebhookSignature('secret', `t=${t}`, body)).toBe(false)
    expect(verifyWebhookSignature('secret', `t=${t},v1=abc`, body)).toBe(false)
    expect(verifyWebhookSignature('secret', '', body)).toBe(false)
    expect(verifyWebhookSignature('secret', null, body)).toBe(false)
    // Several signatures (e.g. during a secret rotation): any match is accepted.
    expect(
      verifyWebhookSignature(
        'secret',
        `t=${t},v1=${computeWebhookSignature('old', t, body)},v1=${computeWebhookSignature('secret', t, body)}`,
        body,
      ),
    ).toBe(true)
  })
})

describe('startWebhookDispatcher', () => {
  afterEach(async () => {
    await stopWebhookDispatcher()
  })

  it('delivers shortly after a webhook.enqueued event', async () => {
    const receiver = await startReceiver()
    const hook = await newWebhook({ url: receiver.url, events: ['segment.*'] })
    startWebhookDispatcher()
    // Let the initial run finish, then enqueue.
    await new Promise((r) => setTimeout(r, 100))
    await sendTestWebhook(owner(), { projectId: projectId(), webhookId: hook.id })
    const deadline = Date.now() + 5 * SECOND
    while (receiver.requests.length === 0) {
      if (Date.now() > deadline) throw new Error('dispatcher did not deliver')
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(receiver.requests[0]?.headers['x-halyard-event']).toBe('webhook.test')
  })
})

describe('private network guard (WEBHOOK_BLOCK_PRIVATE_NETWORKS)', () => {
  afterEach(() => {
    delete process.env.WEBHOOK_BLOCK_PRIVATE_NETWORKS
  })

  const guardOn = () => {
    process.env.WEBHOOK_BLOCK_PRIVATE_NETWORKS = 'true'
  }

  it('is off by default, so loopback receivers get deliveries', async () => {
    process.env.WEBHOOK_BLOCK_PRIVATE_NETWORKS = 'false'
    const receiver = await startReceiver()
    receiver.reply(() => ({ status: 500, body: 'internal details' }))
    const { delivery } = await hookWithDelivery(receiver)
    expect(await deliverPendingWebhooks()).toEqual({ delivered: 0, retrying: 1, failed: 0 })
    expect(receiver.requests).toHaveLength(1)
    // Without the guard error bodies are kept for debugging.
    expect((await deliveryOf(delivery.id)).lastResponseBody).toBe('internal details')
  })

  it('rejects private targets when webhooks are created or updated', async () => {
    const created = await newWebhook({ url: 'https://hooks.example.com/x' })
    guardOn()
    await expect(newWebhook({ url: 'http://127.0.0.1:9000/hook' })).rejects.toMatchObject({
      status: 400,
      message: PRIVATE_TARGET_ERROR,
    })
    await expect(newWebhook({ url: 'http://localhost/hook' })).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      updateWebhook(owner(), {
        projectId: projectId(),
        webhookId: created.id,
        patch: { url: 'http://[::1]/hook' },
      }),
    ).rejects.toMatchObject({ status: 400, message: PRIVATE_TARGET_ERROR })
    // Changes that do not touch the URL are not affected.
    await expect(
      updateWebhook(owner(), {
        projectId: projectId(),
        webhookId: created.id,
        patch: { name: 'Renamed' },
      }),
    ).resolves.toMatchObject({ name: 'Renamed' })
  })

  it('fails deliveries to private targets without sending or retrying', async () => {
    const receiver = await startReceiver()
    const { delivery } = await hookWithDelivery(receiver)
    guardOn()
    expect(await deliverPendingWebhooks()).toEqual({ delivered: 0, retrying: 0, failed: 1 })
    expect(receiver.requests).toHaveLength(0)
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastStatusCode: null,
      lastError: PRIVATE_TARGET_ERROR,
      lastResponseBody: null,
    })
  })

  it('checks host names again before every delivery', async () => {
    const receiver = await startReceiver()
    const port = new URL(receiver.url).port
    const hook = await newWebhook({
      url: `http://hooks.internal.example:${port}/x`,
      events: ['segment.*'],
    })
    const delivery = await sendTestWebhook(owner(), { projectId: projectId(), webhookId: hook.id })
    guardOn()

    // The name stops resolving: an ordinary, retried failure.
    const unresolvable = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    }
    expect(await deliverPendingWebhooks(new Date(), { resolver: unresolvable })).toEqual({
      delivered: 0,
      retrying: 1,
      failed: 0,
    })
    expect((await deliveryOf(delivery.id)).lastError).toMatch(/resolve/)

    // DNS now points the name at a private address (rebinding): blocked for good.
    const rebound = async () => [{ address: '10.0.0.7', family: 4 }]
    const next = (await deliveryOf(delivery.id)).nextAttemptAt
    expect(await deliverPendingWebhooks(next, { resolver: rebound })).toEqual({
      delivered: 0,
      retrying: 0,
      failed: 1,
    })
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'failed',
      attempts: 2,
      lastError: PRIVATE_TARGET_ERROR,
    })
    expect(receiver.requests).toHaveLength(0)
  })

  it('pins the connection to the vetted addresses', async () => {
    const receiver = await startReceiver()
    const port = new URL(receiver.url).port
    // `pinned.invalid` cannot resolve; the request only arrives through the pinned lookup.
    const response = await postWebhook(
      `http://pinned.invalid:${port}/hooks/halyard`,
      { 'Content-Type': 'application/json' },
      '{"ok":true}',
      { signal: AbortSignal.timeout(5_000), addresses: [{ address: '127.0.0.1', family: 4 }] },
    )
    expect(response).toEqual({ statusCode: 200, body: 'ok' })
    expect(receiver.requests[0]).toMatchObject({
      method: 'POST',
      body: '{"ok":true}',
      headers: { host: `pinned.invalid:${port}` },
    })
    await expect(
      postWebhook(`http://pinned.invalid:${port}/`, {}, '', {
        signal: AbortSignal.timeout(5_000),
      }),
    ).rejects.toThrow()
  })

  it('shows response bodies only to members who can manage webhooks', async () => {
    const receiver = await startReceiver()
    receiver.reply(() => ({ status: 500, body: 'stack trace' }))
    const { hook } = await hookWithDelivery(receiver)
    await deliverPendingWebhooks()
    const ref = { projectId: projectId(), webhookId: hook.id }
    expect((await listDeliveries(owner(), ref)).items[0]?.lastResponseBody).toBe('stack trace')
    const asViewer = (await listDeliveries(fx.viewer.actor, ref)).items[0]
    expect(asViewer).toMatchObject({ lastStatusCode: 500, lastResponseBody: null })
  })
})
