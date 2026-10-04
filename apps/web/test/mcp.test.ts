import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { auth } from '@/lib/auth'
import { Route as mcpRoute } from '@/routes/mcp'
import { listAuditLog } from '@/server/services/audit-log'
import { createFlag } from '@/server/services/flags'
import { createProjectFixture, type ProjectFixture } from './factories'
import { resetDatabase } from './helpers'

const BASE = 'http://localhost:3000'

type Handler = (args: { request: Request }) => Promise<Response>
// biome-ignore lint/suspicious/noExplicitAny: route options are typed per method
const handlerOf = (method: string): Handler => (mcpRoute as any).options.server.handlers[method]

/** Sends requests straight to the route handlers instead of over the network. */
const routeFetch = async (url: string | URL, init?: RequestInit) => {
  const request = new Request(url, init)
  const handler = handlerOf(request.method)
  if (!handler) return new Response(null, { status: 405 })
  return handler({ request })
}

let source: ProjectFixture
let other: ProjectFixture

async function createKey(fx: ProjectFixture, access: 'read' | 'write', name = `${access} key`) {
  const created = await auth.api.createApiKey({
    body: {
      configId: 'management',
      organizationId: fx.projectId,
      userId: fx.owner.user.id,
      name,
      permissions: { project: access === 'write' ? ['read', 'write'] : ['read'] },
      metadata: { projectId: fx.projectId },
    },
  })
  return created.key
}

async function connect(key: string, mode: 'legacy' | 'auto' = 'legacy') {
  const client = new Client(
    { name: 'halyard-test', version: '1.0.0' },
    { versionNegotiation: { mode } },
  )
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    fetch: routeFetch,
    requestInit: { headers: { authorization: `Bearer ${key}` } },
  })
  await client.connect(transport)
  return client
}

/** Calls a tool and parses its JSON text result. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const [content] = result.content as { type: string; text: string }[]
  return {
    isError: result.isError === true,
    // biome-ignore lint/suspicious/noExplicitAny: test helper reading arbitrary tool output
    body: JSON.parse(content?.text ?? 'null') as any,
  }
}

const post = (headers: Record<string, string>) =>
  handlerOf('POST')({
    request: new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  })

beforeEach(async () => {
  await resetDatabase()
  source = await createProjectFixture('source')
  other = await createProjectFixture('other')
})

describe('authentication', () => {
  it('answers 401 without a valid management key', async () => {
    const cases: Record<string, string>[] = [
      {},
      { authorization: 'Bearer hal_mgmt_nope' },
      { authorization: 'Bearer hal_sdk_whatever' },
    ]
    for (const headers of cases) {
      const response = await post(headers)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ error: 'UNAUTHORIZED' })
    }
  })

  it('refuses browser requests from other origins', async () => {
    const key = await createKey(source, 'read')
    const response = await post({ authorization: `Bearer ${key}`, origin: 'https://evil.test' })
    expect(response.status).toBe(403)
  })
})

describe.each(['legacy', 'auto'] as const)('tools (%s protocol negotiation)', (mode) => {
  it('offers only read tools to read-only keys', async () => {
    const client = await connect(await createKey(source, 'read'), mode)
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true)
    expect(tools.map((t) => t.name)).toContain('get_flag')
    expect(tools.map((t) => t.name)).not.toContain('create_flag')

    const project = await call(client, 'get_project')
    expect(project.body).toMatchObject({ slug: 'source', access: 'read' })
    expect(project.body.environments.map((e: { key: string }) => e.key)).toContain('production')
    await client.close()
  })

  it('offers every tool with an object input schema to write keys', async () => {
    const client = await connect(await createKey(source, 'write'), mode)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['create_flag', 'update_flag_environment', 'delete_segment']),
    )
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object')
    await client.close()
  })
})

describe('flag lifecycle', () => {
  it('creates, targets, evaluates and deletes a flag as the key', async () => {
    const client = await connect(await createKey(source, 'write', 'Agent'))

    const created = await call(client, 'create_flag', {
      key: 'new-checkout',
      name: 'New checkout',
      type: 'boolean',
      tags: ['payments'],
    })
    expect(created.isError).toBe(false)
    expect(created.body).toMatchObject({ key: 'new-checkout', type: 'boolean' })

    const segment = await call(client, 'create_segment', {
      key: 'beta',
      name: 'Beta testers',
      conditions: [
        { type: 'attribute', attribute: 'email', operator: 'ends_with', value: '@acme.test' },
      ],
    })
    expect(segment.isError).toBe(false)

    const flag = await call(client, 'get_flag', { flagKey: 'new-checkout' })
    const staging = flag.body.environments.find(
      (e: { environmentKey: string }) => e.environmentKey === 'staging',
    )
    const targeted = await call(client, 'update_flag_environment', {
      flagKey: 'new-checkout',
      environmentKey: 'staging',
      enabled: true,
      fallthrough: { type: 'variant', variant: 'off' },
      rules: [
        {
          description: 'Beta testers',
          conditions: [{ type: 'segment', segmentKey: 'beta' }],
          serve: { type: 'variant', variant: 'on' },
        },
      ],
      expectedVersion: staging.version,
    })
    expect(targeted.isError).toBe(false)
    expect(targeted.body).toMatchObject({ enabled: true, version: staging.version + 1 })

    const evaluate = (email: string) =>
      call(client, 'evaluate_flags', {
        environmentKey: 'staging',
        flagKey: 'new-checkout',
        context: { targetingKey: email, email },
      })
    expect((await evaluate('ann@acme.test')).body.results[0]).toMatchObject({ value: true })
    expect((await evaluate('bob@example.com')).body.results[0]).toMatchObject({ value: false })

    const listed = await call(client, 'list_flags', { search: 'checkout' })
    expect(listed.body).toHaveLength(1)
    expect(listed.body[0].environments).toContainEqual(
      expect.objectContaining({ environmentKey: 'staging', enabled: true, ruleCount: 1 }),
    )

    const inUse = await call(client, 'delete_segment', { segmentKey: 'beta' })
    expect(inUse.isError).toBe(true)
    expect(inUse.body).toMatchObject({ error: 'SEGMENT_IN_USE', usages: [expect.any(Object)] })

    const deleted = await call(client, 'delete_flag', { flagKey: 'new-checkout' })
    expect(deleted.body).toMatchObject({ key: 'new-checkout' })
    expect((await call(client, 'get_flag', { flagKey: 'new-checkout' })).body).toMatchObject({
      error: 'NOT_FOUND',
    })

    const audit = await listAuditLog(source.owner.actor, {
      projectId: source.projectId,
      action: 'flag.*',
    })
    expect(audit.items.map((entry) => entry.action)).toEqual([
      'flag.deleted',
      'flag.environment_updated',
      'flag.created',
    ])
    for (const entry of audit.items) {
      expect(entry).toMatchObject({ actorType: 'api_key', actorName: 'Agent' })
    }
    await client.close()
  })

  it('reports stale versions and validation problems as tool errors', async () => {
    await createFlag(source.owner.actor, {
      projectId: source.projectId,
      key: 'search',
      name: 'Search',
      type: 'boolean',
    })
    const client = await connect(await createKey(source, 'write'))

    const stale = await call(client, 'toggle_flag', {
      flagKey: 'search',
      environmentKey: 'production',
      enabled: true,
      expectedVersion: 99,
    })
    expect(stale).toMatchObject({ isError: true, body: { error: 'CONFLICT' } })

    const unknownVariant = await call(client, 'update_flag_environment', {
      flagKey: 'search',
      environmentKey: 'production',
      fallthrough: { type: 'variant', variant: 'missing' },
    })
    expect(unknownVariant).toMatchObject({ isError: true, body: { error: 'BAD_REQUEST' } })
    await client.close()
  })

  it('only sees the project of its key', async () => {
    await createFlag(other.owner.actor, {
      projectId: other.projectId,
      key: 'secret',
      name: 'Secret',
      type: 'boolean',
    })
    const client = await connect(await createKey(source, 'write'))
    expect((await call(client, 'list_flags')).body).toEqual([])
    expect((await call(client, 'get_flag', { flagKey: 'secret' })).body).toMatchObject({
      error: 'NOT_FOUND',
    })
    await client.close()
  })
})
