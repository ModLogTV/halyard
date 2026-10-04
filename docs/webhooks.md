# Webhooks

A webhook sends an HTTP `POST` to a URL of your choice whenever something changes in
a project: a flag is toggled, a segment is edited, a scheduled change runs, and so on.
Webhooks are managed per project by its owners (`webhook:create|update|delete`);
every member can see them and their deliveries (`webhook:read`).

## Events

Every entry in the audit log is also a webhook event, and the event type is the audit
action, for example `flag.toggled`. A webhook subscribes to a list of patterns:

| Pattern | Matches |
| --- | --- |
| `*` | every event |
| `flag.*` | every event whose type starts with `flag.` |
| `flag.toggled` | exactly that event |

Common event types:

| Type | When |
| --- | --- |
| `flag.created`, `flag.updated`, `flag.deleted` | a flag was created, edited (name, description, tags, variants) or deleted |
| `flag.toggled` | a flag was turned on or off in one environment |
| `flag.environment_updated` | rules, fallthrough or off variant changed in one environment |
| `flag.promoted` | a configuration was copied from one environment to another |
| `flag.archived`, `flag.unarchived` | a flag was archived or restored |
| `segment.*` | `segment.created`, `segment.updated`, `segment.deleted` |
| `environment.*` | `environment.created`, `environment.updated`, `environment.deleted` |
| `experiment.*` | experiment lifecycle events |
| `schedule.*` | `schedule.created`, `schedule.staged_rollout_created`, `schedule.updated`, `schedule.cancelled`, `schedule.plan_cancelled`, `schedule.executed`, `schedule.failed` |
| `member.*` | `member.invited`, `member.joined`, `member.left`, `member.removed`, `member.role_changed`, `member.invitation_canceled` |
| `api_key.*` | `api_key.created`, `api_key.deleted` |
| `project.*` | `project.created`, `project.updated` |
| `webhook.*` | `webhook.created`, `webhook.updated`, `webhook.deleted`, `webhook.secret_rotated` |
| `webhook.test` | sent by the **Send test event** button, to that webhook only |

The UI offers this list from `WEBHOOK_EVENT_TYPES` in
`apps/web/src/server/services/webhooks.ts`.

Deliveries are queued in the same database transaction as the change itself, so a
webhook fires if and only if the change was committed.

## Request

```http
POST /your/endpoint HTTP/1.1
Content-Type: application/json
User-Agent: Halyard-Webhooks/1
X-Halyard-Event: flag.toggled
X-Halyard-Delivery: 5d0f7c1e-8a43-4b8e-9d0a-3f0c2c7b6a11
X-Halyard-Timestamp: 1767225600
X-Halyard-Signature: t=1767225600,v1=6f1c…(64 hex characters)
```

```json
{
  "id": "0b8e2f8c-…",
  "type": "flag.toggled",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "project": { "id": "…", "slug": "acme" },
  "environment": { "id": "…", "key": "production" },
  "actor": { "type": "user", "id": "…", "name": "Olivia Owner" },
  "entity": { "type": "flag", "id": "…", "key": "checkout" },
  "before": { "enabled": false, "offVariant": "off", "fallthrough": { "type": "variant", "variant": "on" }, "rules": [] },
  "after": { "enabled": true, "offVariant": "off", "fallthrough": { "type": "variant", "variant": "on" }, "rules": [] }
}
```

- `id` identifies the event (it is the audit log entry id). All webhooks receive the
  same `id` for the same event.
- `X-Halyard-Delivery` identifies one delivery of one event to one webhook and stays
  the same across retries. Use it to de-duplicate.
- `environment` is `null` for events that are not about one environment.
- `actor.type` is `user`, `api_key` or `system`. Background work (for example a
  scheduled change applied by the scheduler) is reported as
  `{ "type": "system", "id": null, "name": "Scheduler" }`.
- `before` / `after` are the same snapshots that the audit log stores; either may be
  `null` (creation, deletion).

## Verifying signatures

Every webhook has a secret, shown once when the webhook is created (and when it is
rotated). Halyard signs each request:

```
signature = hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
X-Halyard-Signature: t=<timestamp>,v1=<signature>
```

`timestamp` is Unix time in seconds and is also sent as `X-Halyard-Timestamp`.
`rawBody` is the exact request body; verify it before parsing the JSON. Reject
requests whose timestamp is more than five minutes away from your clock, so a
captured request cannot be replayed later. The header may carry more than one `v1`
value; accept the request when any of them matches.

Node.js (no dependencies):

```js
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const SECRET = process.env.HALYARD_WEBHOOK_SECRET

function verify(secret, header, rawBody, toleranceSeconds = 300) {
  if (!header) return false
  let timestamp
  const signatures = []
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2)
    if (key === 't') timestamp = Number(value)
    if (key === 'v1') signatures.push(value)
  }
  if (!Number.isInteger(timestamp) || signatures.length === 0) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest()
  return signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  })
}

createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8')
    if (!verify(SECRET, req.headers['x-halyard-signature'], rawBody)) {
      res.writeHead(401).end('invalid signature')
      return
    }
    const event = JSON.parse(rawBody)
    console.log(`received ${event.type} for ${event.entity.key}`)
    res.writeHead(204).end()
  })
}).listen(8080)
```

With Express, use `express.raw({ type: 'application/json' })` (not `express.json()`)
on the webhook route so that you verify the bytes Halyard sent.

Inside the Halyard code base the same check is available as
`verifyWebhookSignature(secret, header, rawBody, { toleranceSeconds, now })` from
`apps/web/src/server/services/webhooks.ts`.

## Responses, retries and timeouts

- Any `2xx` response within **10 seconds** counts as delivered. Redirects are not
  followed and count as failures, as do other status codes, connection errors and
  timeouts.
- The status code and the first 2 KB of the response body of the latest attempt are
  stored with the delivery. Response bodies are shown only to members who can manage
  webhooks (owners); other members see the status code only. With
  `WEBHOOK_BLOCK_PRIVATE_NETWORKS` on, bodies of non-2xx responses are not stored at
  all.
- Failed deliveries are retried with exponential backoff: after the n-th failed
  attempt the next one is scheduled `min(2^n × 30 s, 6 h)` later, ±10 % jitter
  (about 1 min, 2 min, 4 min, 8 min, 16 min, 32 min, 64 min). After **8** failed
  attempts the delivery is marked `failed`.
- **Redeliver** puts any delivery back in the queue with its attempt counter reset.
- Disabling a webhook marks its pending deliveries as failed (`Webhook disabled`);
  re-enabling it does not replay them. Deleting a webhook deletes its deliveries.

Delivery is **at least once**. In rare cases (a Halyard replica dies while a request is
in flight, or a redelivery is requested during an attempt) the same delivery can
arrive twice; de-duplicate on `X-Halyard-Delivery`. Order is not guaranteed either:
use `createdAt` if you need to order events.

## Blocking private networks (`WEBHOOK_BLOCK_PRIVATE_NETWORKS`)

| Variable | Default | |
| --- | --- | --- |
| `WEBHOOK_BLOCK_PRIVATE_NETWORKS` | `false` | `true` rejects webhook targets on loopback, private and other non-public networks |

By default a webhook may point anywhere, including `localhost` and cluster-internal
services, because that is what most self-hosted installations need (a Slack relay in
the same cluster, an internal deploy bot, …).

**On instances where people who are not administrators of the server can create
projects (multi-tenant / shared instances), set `WEBHOOK_BLOCK_PRIVATE_NETWORKS=true`.**
Otherwise any project owner can make Halyard send requests to internal services
(server-side request forgery), for example cloud metadata endpoints such as
`169.254.169.254`.

With the guard on:

- Saving a webhook (create, or update with a new URL) fails with `400` when the URL is
  not `http(s)`, its host is `localhost` or `*.localhost`, it is a literal non-public
  IP address, or the host name resolves (`dns.lookup(host, { all: true })`) to **any**
  non-public address. Changing other fields of an existing webhook is not affected.
- Before **every** delivery attempt the target is checked again. If it is not allowed
  any more (for example its DNS now points at a private address), the delivery is
  marked `failed` with the error `Target resolves to a private address` and is not
  retried. A host name that does not resolve is an ordinary, retried failure.
- The connection is **pinned** to the addresses that were just checked (a custom DNS
  `lookup` on `node:http(s)`, which works under both Node and Bun), so a DNS rebinding
  between the check and the connection cannot reach a private address. TLS
  certificates are still verified against the URL's host name.
- Bodies of non-2xx responses are not stored.

Non-public means: `0.0.0.0/8` (incl. the unspecified address), `127.0.0.0/8`,
`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`
(CGNAT), `192.0.0.0/24`, `198.18.0.0/15`, multicast and reserved space
(`224.0.0.0/3`), and for IPv6 `::`, `::1`, `fc00::/7` (ULA), `fe80::/10`,
`fec0::/10`, `ff00::/8`, plus IPv4-mapped (`::ffff:a.b.c.d`), IPv4-compatible, NAT64
(`64:ff9b::/96`) and 6to4 (`2002::/16`) forms of non-public IPv4 addresses. Redirects
are never followed, so a public endpoint cannot bounce a delivery into the network.

The variable is read at request time. Webhooks saved while the guard was off are
checked on their next delivery.

## How dispatching works

Every replica runs a dispatcher (`apps/web/src/server/workers/webhook-dispatcher.ts`)
when workers are enabled (`ENABLE_WORKERS`, on by default). It runs every 10 seconds
(`WEBHOOK_DISPATCH_INTERVAL_MS`) and, debounced, right after any replica queues a
delivery (the `webhook.enqueued` event on the Postgres `LISTEN/NOTIFY` bus).

Each run claims up to 20 due deliveries in one short transaction:

```sql
select … from webhook_deliveries d join webhooks w on w.id = d.webhook_id
where d.status = 'pending' and d.next_attempt_at <= now() and w.enabled
order by d.next_attempt_at
limit 20
for update of d skip locked
```

and moves their `next_attempt_at` five minutes into the future before committing. The
status stays `pending`; the moved `next_attempt_at` is a **lease** that hides the rows
from other replicas while the requests are in flight (in parallel, each with the
10 second timeout). The outcome is written only if the lease is still held
(`next_attempt_at` unchanged), so a redelivery requested meanwhile takes precedence.
If the replica dies, the lease simply expires and another replica retries the
delivery. Running any number of replicas is therefore safe and every delivery attempt
is made by exactly one of them.
