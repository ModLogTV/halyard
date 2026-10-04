import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, flags } from '@/db/schema'
import { auth } from '@/lib/auth'
import { Route as exportRoute } from '@/routes/api/v1/export'
import { Route as exportFlagdRoute } from '@/routes/api/v1/export/flagd'
import { Route as flagsRoute } from '@/routes/api/v1/flags'
import { Route as importRoute } from '@/routes/api/v1/import'
import { Route as projectRoute } from '@/routes/api/v1/projects/current'
import { exportProject } from '@/server/services/transfer'
import { createProjectFixture, type ProjectFixture } from './factories'
import { resetDatabase } from './helpers'
import { seedProject } from './transfer-seed'

const BASE = 'http://halyard.test'

type Handler = (args: { request: Request }) => Promise<Response>
// biome-ignore lint/suspicious/noExplicitAny: route options are typed per method
const handlerOf = (route: any, method: 'GET' | 'POST'): Handler =>
  route.options.server.handlers[method]

const getProject = handlerOf(projectRoute, 'GET')
const getFlags = handlerOf(flagsRoute, 'GET')
const getExport = handlerOf(exportRoute, 'GET')
const getFlagd = handlerOf(exportFlagdRoute, 'GET')
const postImport = handlerOf(importRoute, 'POST')

let source: ProjectFixture
let target: ProjectFixture

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

const request = (path: string, init: { key?: string; method?: string; body?: unknown } = {}) =>
  new Request(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.key && { authorization: `Bearer ${init.key}` }),
      ...(init.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

// biome-ignore lint/suspicious/noExplicitAny: test helper reading arbitrary response JSON
const json = async (response: Response) => (await response.json()) as Record<string, any>

let readKey: string
let targetWrite: string

beforeEach(async () => {
  await resetDatabase()
  source = await createProjectFixture('source')
  target = await createProjectFixture('target')
  await seedProject(source)
  readKey = await createKey(source, 'read')
  targetWrite = await createKey(target, 'write', 'Deploy bot')
})

describe('authentication', () => {
  it('answers 401 without a key, with a bad key and with an SDK key shape', async () => {
    for (const [handler, path] of [
      [getProject, '/api/v1/projects/current'],
      [getFlags, '/api/v1/flags'],
      [getExport, '/api/v1/export'],
      [getFlagd, '/api/v1/export/flagd?environment=production'],
    ] as const) {
      const missing = await handler({ request: request(path) })
      expect(missing.status).toBe(401)
      expect(await json(missing)).toMatchObject({
        error: 'UNAUTHORIZED',
        message: expect.any(String),
      })

      const bogus = await handler({ request: request(path, { key: 'hal_mgmt_nope' }) })
      expect(bogus.status).toBe(401)
      const sdkLike = await handler({ request: request(path, { key: 'hal_sdk_whatever' }) })
      expect(sdkLike.status).toBe(401)
    }
    const post = await postImport({
      request: request('/api/v1/import', { method: 'POST', body: { document: {} } }),
    })
    expect(post.status).toBe(401)
  })

  it('answers 403 when a read-only key imports, even as a dry run', async () => {
    const document = await exportProject(source.owner.actor, { projectId: source.projectId })
    for (const dryRun of [false, true]) {
      const response = await postImport({
        request: request('/api/v1/import', {
          key: readKey,
          method: 'POST',
          body: { document, dryRun },
        }),
      })
      expect(response.status).toBe(403)
      expect(await json(response)).toMatchObject({ error: 'FORBIDDEN' })
    }
  })
})

describe('GET /api/v1/projects/current', () => {
  it('describes the key’s project', async () => {
    const response = await getProject({
      request: request('/api/v1/projects/current', { key: readKey }),
    })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toEqual({
      id: source.projectId,
      name: 'Acme',
      slug: 'source',
      description: null,
      environments: [
        {
          id: source.environmentId('development'),
          key: 'development',
          name: 'Development',
          color: '#3b82f6',
          isProduction: false,
        },
        {
          id: source.environmentId('staging'),
          key: 'staging',
          name: 'Pre-production',
          color: '#a855f7',
          isProduction: false,
        },
        {
          id: source.environmentId('production'),
          key: 'production',
          name: 'Production',
          color: '#e11d48',
          isProduction: true,
        },
      ],
    })
  })
})

describe('GET /api/v1/flags', () => {
  it('lists flag definitions including archived ones', async () => {
    const response = await getFlags({ request: request('/api/v1/flags', { key: readKey }) })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.flags.map((f: { key: string }) => f.key)).toEqual([
      'checkout',
      'limits',
      'plan',
      'theme',
    ])
    expect(body.flags[0]).toEqual({
      key: 'checkout',
      name: 'New checkout',
      description: 'The redesigned checkout',
      type: 'boolean',
      variants: [
        { key: 'on', value: true, name: 'On' },
        { key: 'off', value: false, name: 'Off' },
      ],
      tags: ['payments', 'frontend'],
      archived: false,
    })
    expect(body.flags[3]).toMatchObject({ key: 'theme', type: 'json', archived: true })
  })

  it('only shows the key’s own project', async () => {
    const response = await getFlags({
      request: request('/api/v1/flags', { key: await createKey(target, 'read') }),
    })
    expect((await json(response)).flags).toEqual([])
  })
})

describe('GET /api/v1/export', () => {
  it('returns the export document', async () => {
    const response = await getExport({ request: request('/api/v1/export', { key: readKey }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBeNull()
    const body = await json(response)
    expect(body).toMatchObject({ version: 1, project: { slug: 'source' } })
    expect(body.flags).toHaveLength(4)
    const direct = await exportProject(source.owner.actor, { projectId: source.projectId })
    expect({ ...body, exportedAt: '' }).toEqual(
      JSON.parse(JSON.stringify({ ...direct, exportedAt: '' })),
    )
  })

  it('adds a download header with ?download=1', async () => {
    const response = await getExport({
      request: request('/api/v1/export?download=1', { key: readKey }),
    })
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="source-export.json"',
    )
  })
})

describe('GET /api/v1/export/flagd', () => {
  it('returns the flagd definition and warnings of an environment', async () => {
    const response = await getFlagd({
      request: request('/api/v1/export/flagd?environment=production', { key: readKey }),
    })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(Object.keys(body)).toEqual(['flagd', 'warnings'])
    expect(body.flagd.$schema).toBe('https://flagd.dev/schema/v0/flags.json')
    expect(Object.keys(body.flagd.flags)).toEqual(['checkout', 'limits', 'plan'])
    expect(body.flagd.flags.checkout.targeting).toBeDefined()
    expect(body.flagd.$evaluators['beta-users']).toBeDefined()
    expect(body.warnings.some((w: string) => w.includes('fractional'))).toBe(true)
  })

  it('answers 400 for an unknown or missing environment', async () => {
    const unknown = await getFlagd({
      request: request('/api/v1/export/flagd?environment=nope', { key: readKey }),
    })
    expect(unknown.status).toBe(400)
    expect(await json(unknown)).toEqual({
      error: 'BAD_REQUEST',
      message: 'Unknown environment "nope"',
    })

    const missing = await getFlagd({ request: request('/api/v1/export/flagd', { key: readKey }) })
    expect(missing.status).toBe(400)
    expect(await json(missing)).toMatchObject({ error: 'BAD_REQUEST' })
  })
})

describe('POST /api/v1/import', () => {
  // Management keys act as editors, who cannot change environments: send documents that
  // describe the target's environments as they are.
  const documentForTarget = async () => {
    const document = await exportProject(source.owner.actor, { projectId: source.projectId })
    const { environments } = await exportProject(target.owner.actor, {
      projectId: target.projectId,
    })
    return { ...document, environments }
  }
  const importInto = (key: string, body: unknown) =>
    postImport({ request: request('/api/v1/import', { key, method: 'POST', body }) })
  const targetFlags = () => db.select().from(flags).where(eq(flags.projectId, target.projectId))

  it('previews with dryRun and writes nothing', async () => {
    const document = await documentForTarget()
    const response = await importInto(targetWrite, { document, dryRun: true })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({ applied: false, errors: [], warnings: [] })
    expect(body.diff.flags.create).toHaveLength(4)
    expect(body.diff.segments.create).toHaveLength(2)
    expect(body.diff.environments).toMatchObject({ create: [], update: [], unchanged: 3 })
    expect(await targetFlags()).toHaveLength(0)
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, 'import.applied')),
    ).toHaveLength(0)
  })

  it('applies the document and records the key as the actor', async () => {
    const document = await documentForTarget()
    const response = await importInto(targetWrite, { document })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({ applied: true, errors: [] })
    expect(body.diff.flags.create.map((f: { key: string }) => f.key)).toEqual([
      'checkout',
      'limits',
      'plan',
      'theme',
    ])
    expect(await targetFlags()).toHaveLength(4)

    const [summary] = await db.select().from(auditLog).where(eq(auditLog.action, 'import.applied'))
    expect(summary).toMatchObject({
      projectId: target.projectId,
      actorType: 'api_key',
      actorName: 'Deploy bot',
    })

    const again = await json(await importInto(targetWrite, { document }))
    expect(again).toMatchObject({ applied: true })
    expect(again.diff.flags).toMatchObject({ create: [], update: [], delete: [], unchanged: 4 })
  })

  it('only prunes when asked to', async () => {
    const document = await documentForTarget()
    await importInto(targetWrite, { document })
    const smaller = { ...document, flags: document.flags.filter((f) => f.key !== 'theme') }

    const kept = await json(await importInto(targetWrite, { document: smaller }))
    expect(kept.diff.flags.delete).toEqual([])
    expect(await targetFlags()).toHaveLength(4)

    const dry = await json(
      await importInto(targetWrite, { document: smaller, prune: true, dryRun: true }),
    )
    expect(dry.diff.flags.delete).toEqual([{ key: 'theme', name: 'Theme' }])
    expect(await targetFlags()).toHaveLength(4)

    const pruned = await json(await importInto(targetWrite, { document: smaller, prune: true }))
    expect(pruned.diff.flags.delete).toHaveLength(1)
    expect(await targetFlags()).toHaveLength(3)
  })

  it('answers 403 for environment changes, which editors cannot make', async () => {
    const document = await exportProject(source.owner.actor, { projectId: source.projectId })
    const dry = await json(await importInto(targetWrite, { document, dryRun: true }))
    expect(dry.errors).toEqual(['Your role is not allowed to update environments'])

    const response = await importInto(targetWrite, { document })
    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({ error: 'FORBIDDEN' })
    expect(await targetFlags()).toHaveLength(0)
  })

  it('answers 422 with the problems and applies nothing when the document is invalid', async () => {
    const document = await documentForTarget()
    const bad = JSON.parse(JSON.stringify(document)) as typeof document
    const flag = bad.flags[0]
    if (!flag) throw new Error('missing flag')
    flag.key = 'bad key'

    const response = await importInto(targetWrite, { document: bad })
    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body).toMatchObject({ error: 'IMPORT_REJECTED', applied: false })
    expect(body.errors.join('\n')).toContain('Flag key "bad key" is invalid')
    expect(body.diff.flags.create).toHaveLength(3)
    expect(await targetFlags()).toHaveLength(0)

    // As a dry run the same problems are reported with a 200.
    const dry = await importInto(targetWrite, { document: bad, dryRun: true })
    expect(dry.status).toBe(200)
    expect((await json(dry)).errors.length).toBeGreaterThan(0)
  })

  it('answers 400 for malformed requests', async () => {
    const notJson = await postImport({
      request: new Request(`${BASE}/api/v1/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${targetWrite}` },
        body: '{nope',
      }),
    })
    expect(notJson.status).toBe(400)
    expect((await importInto(targetWrite, { prune: true })).status).toBe(400)
    expect((await importInto(targetWrite, { document: {}, prune: 'yes' })).status).toBe(400)
    expect((await importInto(targetWrite, { document: {}, dryRun: 1 })).status).toBe(400)
    // Not an export document: reported as a problem, not a server error.
    const garbage = await importInto(targetWrite, { document: { nope: true } })
    expect(garbage.status).toBe(422)
  })
})
