import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import { db } from '@/db'
import { webhookDeliveries, webhooks } from '@/db/schema'
import {
  assertAllowedWebhookTarget,
  PRIVATE_TARGET_ERROR,
  pinnedLookup,
  privateNetworksBlocked,
  type WebhookResolver,
  WebhookTargetError,
} from '@/server/services/webhook-targets'
import { signatureHeader } from '@/server/services/webhooks'
import { createPoller, intervalFromEnv, type Poller } from './poller'

/**
 * Sends pending webhook deliveries.
 *
 * Claiming: one transaction selects up to {@link DISPATCH_BATCH_SIZE} due deliveries
 * (`status = 'pending' and next_attempt_at <= now`, enabled webhook) `FOR UPDATE
 * SKIP LOCKED` and moves their `next_attempt_at` to `now + LEASE_MS`. The status
 * stays `pending`; the moved `next_attempt_at` is a lease that hides the rows from
 * other replicas while the requests are in flight. Results are written only while
 * the lease is still held (`next_attempt_at` unchanged), so a redelivery requested
 * meanwhile wins. A replica that dies mid-flight leaves its deliveries to be retried
 * when the lease expires, so delivery is at-least-once: receivers should
 * de-duplicate on `X-Halyard-Delivery`.
 *
 * Retries: a non-2xx response, a network error or a timeout counts as a failed
 * attempt; the next one is scheduled after `min(2^attempts × 30 s, 6 h)` ± 10 %
 * jitter. After {@link MAX_ATTEMPTS} failed attempts the delivery is `failed`.
 *
 * Private networks: with `WEBHOOK_BLOCK_PRIVATE_NETWORKS=true` the target is checked
 * (and resolved) again before every attempt; a target that is not allowed fails the
 * delivery at once ({@link PRIVATE_TARGET_ERROR}), otherwise the connection is pinned
 * to the vetted addresses. Bodies of non-2xx responses are then not stored.
 */
export const DISPATCH_BATCH_SIZE = 20
export const LEASE_MS = 5 * 60_000
export const DELIVERY_TIMEOUT_MS = 10_000
export const MAX_ATTEMPTS = 8
export const BASE_BACKOFF_MS = 30_000
export const MAX_BACKOFF_MS = 6 * 60 * 60_000
export const MAX_RESPONSE_BODY_BYTES = 2048
export const USER_AGENT = 'Halyard-Webhooks/1'
const DEFAULT_INTERVAL_MS = 10_000

export interface DispatchResult {
  /** Delivered with a 2xx response. */
  delivered: number
  /** Failed and scheduled for another attempt. */
  retrying: number
  /** Failed for the last time. */
  failed: number
}

export interface DispatchOptions {
  /** Request timeout; defaults to {@link DELIVERY_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Host name resolver for the private-network guard; defaults to the system resolver. */
  resolver?: WebhookResolver
}

/** Delay before the next attempt after `attempts` failed attempts, without jitter. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * BASE_BACKOFF_MS, MAX_BACKOFF_MS)
}

const withJitter = (ms: number) => Math.round(ms * (0.9 + Math.random() * 0.2))

interface Claimed {
  id: string
  eventType: string
  payload: unknown
  attempts: number
  url: string
  secret: string
}

async function claimDue(now: Date, lease: Date): Promise<Claimed[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({
        id: webhookDeliveries.id,
        eventType: webhookDeliveries.eventType,
        payload: webhookDeliveries.payload,
        attempts: webhookDeliveries.attempts,
        url: webhooks.url,
        secret: webhooks.secret,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .where(
        and(
          eq(webhookDeliveries.status, 'pending'),
          lte(webhookDeliveries.nextAttemptAt, now),
          eq(webhooks.enabled, true),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.createdAt))
      .limit(DISPATCH_BATCH_SIZE)
      .for('update', { of: webhookDeliveries, skipLocked: true })
    if (due.length === 0) return []
    await tx
      .update(webhookDeliveries)
      .set({ nextAttemptAt: lease })
      .where(
        inArray(
          webhookDeliveries.id,
          due.map((d) => d.id),
        ),
      )
    return due
  })
}

export interface PostResult {
  statusCode: number
  /** At most {@link MAX_RESPONSE_BODY_BYTES} bytes of the response body. */
  body: string
}

/**
 * POSTs `body` to `url` with `node:http(s)` (available under Node and Bun). Redirects
 * are not followed. With `addresses`, the connection is pinned to those addresses
 * through a custom `lookup` (TLS still verifies the certificate for the URL's host
 * name). Only the first {@link MAX_RESPONSE_BODY_BYTES} bytes of the response are
 * read. Rejects on network errors and when `signal` aborts.
 */
export function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
  options: { signal: AbortSignal; addresses?: LookupAddress[] | null },
): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const request = (target.protocol === 'https:' ? https : http).request(target, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      signal: options.signal,
      // A fresh connection per delivery: no pooled sockets shared across targets.
      agent: false,
      ...(options.addresses ? { lookup: pinnedLookup(options.addresses) } : {}),
    })
    request.on('error', reject)
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        const bytes = Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BODY_BYTES)
        // Drop a multi-byte character cut in half by the limit.
        resolve({
          statusCode: response.statusCode ?? 0,
          body: bytes.toString('utf8').replace(/\uFFFD+$/, ''),
        })
      }
      response.on('data', (chunk: Buffer) => {
        if (settled) return
        chunks.push(chunk)
        size += chunk.byteLength
        if (size >= MAX_RESPONSE_BODY_BYTES) {
          finish()
          response.destroy()
        }
      })
      response.on('end', finish)
      response.on('close', finish)
      response.on('error', (error) => {
        if (!settled) reject(error)
      })
    })
    request.end(body)
  })
}

interface AttemptResult {
  ok: boolean
  statusCode: number | null
  error: string | null
  body: string | null
  /** Do not retry (target not allowed). */
  permanent?: boolean
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const code = (error as NodeJS.ErrnoException).code
  return code && !error.message.includes(code) ? `${code}: ${error.message}` : error.message
}

async function send(delivery: Claimed, options: Required<DispatchOptions>): Promise<AttemptResult> {
  const guarded = privateNetworksBlocked()
  let addresses: LookupAddress[] | null = null
  if (guarded) {
    try {
      addresses = await assertAllowedWebhookTarget(delivery.url, {
        enabled: true,
        resolver: options.resolver,
      })
    } catch (error) {
      if (error instanceof WebhookTargetError && error.reason !== 'unresolvable') {
        return {
          ok: false,
          statusCode: null,
          error: PRIVATE_TARGET_ERROR,
          body: null,
          permanent: true,
        }
      }
      return { ok: false, statusCode: null, error: describeError(error), body: null }
    }
  }

  const rawBody = JSON.stringify(delivery.payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await postWebhook(
      delivery.url,
      {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-Halyard-Event': delivery.eventType,
        'X-Halyard-Delivery': delivery.id,
        'X-Halyard-Timestamp': String(timestamp),
        'X-Halyard-Signature': signatureHeader(delivery.secret, timestamp, rawBody),
      },
      rawBody,
      { signal: controller.signal, addresses },
    )
    const ok = response.statusCode >= 200 && response.statusCode < 300
    return {
      ok,
      statusCode: response.statusCode,
      error: ok ? null : `HTTP ${response.statusCode}`,
      // With the guard on, error responses (which internal services may fill with
      // details) are not stored at all.
      body: ok || !guarded ? response.body : null,
    }
  } catch (error) {
    const message = controller.signal.aborted
      ? `Timed out after ${options.timeoutMs} ms`
      : describeError(error)
    return { ok: false, statusCode: null, error: message, body: null }
  } finally {
    clearTimeout(timer)
  }
}

type Outcome = keyof DispatchResult

async function record(
  delivery: Claimed,
  lease: Date,
  result: AttemptResult,
  finishedAt: Date,
): Promise<Outcome | null> {
  const attempts = delivery.attempts + 1
  const outcome: Outcome = result.ok
    ? 'delivered'
    : result.permanent || attempts >= MAX_ATTEMPTS
      ? 'failed'
      : 'retrying'
  const updated = await db
    .update(webhookDeliveries)
    .set({
      attempts,
      lastStatusCode: result.statusCode,
      lastError: result.error,
      lastResponseBody: result.body,
      ...(outcome === 'delivered'
        ? { status: 'success' as const, deliveredAt: finishedAt, nextAttemptAt: finishedAt }
        : outcome === 'failed'
          ? { status: 'failed' as const, nextAttemptAt: finishedAt }
          : {
              nextAttemptAt: new Date(finishedAt.getTime() + withJitter(backoffMs(attempts))),
            }),
    })
    .where(
      and(
        eq(webhookDeliveries.id, delivery.id),
        eq(webhookDeliveries.status, 'pending'),
        eq(webhookDeliveries.nextAttemptAt, lease),
      ),
    )
    .returning({ id: webhookDeliveries.id })
  // Lease lost (redelivered, webhook disabled or deleted meanwhile): drop the result.
  return updated.length > 0 ? outcome : null
}

/**
 * Claims one batch of due deliveries and sends them in parallel. Safe to call
 * concurrently from one or many replicas; each claimed delivery is sent once per
 * attempt. `now` is the dispatcher's clock (tests pass a fixed time).
 */
export async function deliverPendingWebhooks(
  now = new Date(),
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const sendOptions: Required<DispatchOptions> = {
    timeoutMs: options.timeoutMs ?? DELIVERY_TIMEOUT_MS,
    resolver: options.resolver ?? ((host) => lookup(host, { all: true, verbatim: true })),
  }
  const lease = new Date(now.getTime() + LEASE_MS)
  const claimed = await claimDue(now, lease)
  const result: DispatchResult = { delivered: 0, retrying: 0, failed: 0 }
  if (claimed.length === 0) return result

  const startedAt = Date.now()
  await Promise.all(
    claimed.map(async (delivery) => {
      const attempt = await send(delivery, sendOptions)
      const finishedAt = new Date(now.getTime() + (Date.now() - startedAt))
      try {
        const outcome = await record(delivery, lease, attempt, finishedAt)
        if (outcome) result[outcome] += 1
      } catch (error) {
        // The lease expires and the delivery is retried.
        console.error(`webhook dispatcher: failed to record delivery ${delivery.id}`, error)
      }
    }),
  )
  return result
}

let poller: Poller | undefined

/**
 * Starts the dispatcher loop: every `WEBHOOK_DISPATCH_INTERVAL_MS` (default 10 s) and
 * shortly after a `webhook.enqueued` event. Idempotent.
 */
export function startWebhookDispatcher(): void {
  if (poller) return
  poller = createPoller({
    name: 'webhook dispatcher',
    intervalMs: intervalFromEnv('WEBHOOK_DISPATCH_INTERVAL_MS', DEFAULT_INTERVAL_MS),
    events: ['webhook.enqueued'],
    tick: async () => {
      const { delivered, retrying, failed } = await deliverPendingWebhooks()
      return delivered + retrying + failed >= DISPATCH_BATCH_SIZE
    },
  })
  poller.start()
}

export async function stopWebhookDispatcher(): Promise<void> {
  const current = poller
  poller = undefined
  await current?.stop()
}
