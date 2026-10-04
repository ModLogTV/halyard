import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db'
import {
  apikey,
  environments,
  experimentExposures,
  flagEnvironments,
  flagEvaluationStats,
} from '@/db/schema'
import { clearApiKeyCache } from '@/server/auth/api-key'
import { invalidateEnvironment } from '@/server/cache/ruleset-cache'
import { registry } from '@/server/evaluation/metrics'
import { flushTracking } from '@/server/evaluation/tracking'
import {
  handleBulkEvaluation,
  handleConfiguration,
  handleRuleset,
  handleSingleEvaluation,
  ofrepPreflight,
} from '@/server/ofrep/handler'
import {
  createFixtureExperiment,
  createFixtureFlag,
  createFixtureProject,
  createFixtureSdkKey,
  createFixtureSegment,
  type FixtureProject,
  truncateAll,
} from './fixtures'

const BASE = 'http://halyard.test'

interface Seed {
  project: FixtureProject
  envId: string
  key: string
  flagIds: Record<string, string>
  experimentId: string
}

let seed: Seed

async function seedProject(): Promise<Seed> {
  const project = await createFixtureProject({ slug: 'shop' })
  const envId = project.environments.production!.id
  const otherEnvId = project.environments.development!.id
  await createFixtureSegment({
    projectId: project.projectId,
    key: 'beta-testers',
    conditions: [{ type: 'attribute', attribute: 'plan', operator: 'eq', value: 'beta' }],
  })
  const flagIds: Record<string, string> = {}
  const add = async (options: Parameters<typeof createFixtureFlag>[0]) => {
    const flag = await createFixtureFlag(options)
    flagIds[flag.key] = flag.id
    return flag
  }
  await add({
    projectId: project.projectId,
    key: 'new-checkout',
    environments: {
      [envId]: {
        offVariant: 'off',
        rules: [
          {
            id: 'internal',
            conditions: [
              { type: 'attribute', attribute: 'email', operator: 'ends_with', value: '@acme.io' },
            ],
            serve: { type: 'variant', variant: 'on' },
          },
          {
            id: 'beta',
            conditions: [{ type: 'segment', segmentKey: 'beta-testers' }],
            serve: { type: 'variant', variant: 'on' },
          },
        ],
        fallthrough: {
          type: 'rollout',
          variations: [
            { variant: 'on', weight: 50 },
            { variant: 'off', weight: 50 },
          ],
        },
      },
      [otherEnvId]: { enabled: false, offVariant: 'off' },
    },
  })
  await add({
    projectId: project.projectId,
    key: 'kill-switch',
    environments: {
      [envId]: {
        enabled: false,
        offVariant: 'off',
        fallthrough: { type: 'variant', variant: 'on' },
      },
    },
  })
  await add({
    projectId: project.projectId,
    key: 'banner-text',
    type: 'string',
    variants: [
      { key: 'hello', value: 'Hello' },
      { key: 'bye', value: 'Bye' },
    ],
    environments: {
      [envId]: { offVariant: 'bye', fallthrough: { type: 'variant', variant: 'hello' } },
    },
  })
  await add({
    projectId: project.projectId,
    key: 'old-flag',
    archived: true,
    environments: { [envId]: {} },
  })
  // A string flag whose variant holds a number: the engine reports TYPE_MISMATCH.
  await add({
    projectId: project.projectId,
    key: 'broken',
    type: 'string',
    variants: [{ key: 'one', value: 1 }],
    environments: {
      [envId]: { offVariant: 'one', fallthrough: { type: 'variant', variant: 'one' } },
    },
  })
  const experimentFlag = await add({
    projectId: project.projectId,
    key: 'pricing-test',
    type: 'string',
    variants: [
      { key: 'control', value: 'old' },
      { key: 'treatment', value: 'new' },
    ],
    environments: {
      [envId]: { offVariant: 'control', fallthrough: { type: 'variant', variant: 'control' } },
    },
  })
  const experiment = await createFixtureExperiment({
    projectId: project.projectId,
    flagId: experimentFlag.id,
    environmentId: envId,
    key: 'pricing-q4',
    allocation: [
      { variant: 'control', weight: 50 },
      { variant: 'treatment', weight: 50 },
    ],
    controlVariant: 'control',
  })
  const key = await createFixtureSdkKey(project.projectId, envId)
  return { project, envId, key, flagIds, experimentId: experiment.id }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${seed.key}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const single = (flagKey: string, body: unknown, headers?: Record<string, string>) =>
  handleSingleEvaluation(post(`/ofrep/v1/evaluate/flags/${flagKey}`, body, headers), flagKey)
const bulk = (body: unknown, headers?: Record<string, string>) =>
  handleBulkEvaluation(post('/ofrep/v1/evaluate/flags', body, headers))

beforeEach(async () => {
  await truncateAll()
  seed = await seedProject()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('POST /ofrep/v1/evaluate/flags/{key}', () => {
  it('returns TARGETING_MATCH with the variant and rule metadata', async () => {
    const response = await single('new-checkout', {
      context: { targetingKey: 'u1', email: 'ada@acme.io' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.json()).toEqual({
      key: 'new-checkout',
      value: true,
      reason: 'TARGETING_MATCH',
      variant: 'on',
      metadata: { ruleId: 'internal' },
    })
  })

  it('matches segment rules', async () => {
    const response = await single('new-checkout', { context: { targetingKey: 'u2', plan: 'beta' } })
    expect(await response.json()).toMatchObject({
      reason: 'TARGETING_MATCH',
      variant: 'on',
      metadata: { ruleId: 'beta' },
    })
  })

  it('returns STATIC for a fixed fallthrough', async () => {
    const response = await single('banner-text', { context: {} })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      key: 'banner-text',
      value: 'Hello',
      reason: 'STATIC',
      variant: 'hello',
    })
  })

  it('returns DISABLED with the off variant value', async () => {
    const response = await single('kill-switch', { context: { targetingKey: 'u1' } })
    expect(await response.json()).toEqual({
      key: 'kill-switch',
      value: false,
      reason: 'DISABLED',
      variant: 'off',
    })
  })

  it('treats an empty body as an empty context', async () => {
    const response = await single('kill-switch', '')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ reason: 'DISABLED' })
  })

  it('returns a sticky SPLIT for percentage rollouts', async () => {
    const variants = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const context = { context: { targetingKey: `user-${i}` } }
      const first = (await (await single('new-checkout', context)).json()) as {
        reason: string
        variant: string
      }
      const second = (await (await single('new-checkout', context)).json()) as { variant: string }
      expect(first.reason).toBe('SPLIT')
      expect(second.variant).toBe(first.variant)
      variants.add(first.variant)
    }
    expect(variants).toEqual(new Set(['on', 'off']))
  })

  it('returns 404 FLAG_NOT_FOUND for unknown and archived flags', async () => {
    for (const flagKey of ['does-not-exist', 'old-flag']) {
      const response = await single(flagKey, { context: {} })
      expect(response.status).toBe(404)
      const body = (await response.json()) as Record<string, unknown>
      expect(body).toMatchObject({ key: flagKey, errorCode: 'FLAG_NOT_FOUND' })
      expect(body.errorDetails).toEqual(expect.any(String))
    }
  })

  it('returns 400 TARGETING_KEY_MISSING when a rollout needs a targeting key', async () => {
    const response = await single('new-checkout', { context: { email: 'someone@example.com' } })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      key: 'new-checkout',
      errorCode: 'TARGETING_KEY_MISSING',
    })
  })

  it('returns 400 GENERAL for configuration errors such as a type mismatch', async () => {
    const response = await single('broken', { context: {} })
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({ key: 'broken', errorCode: 'GENERAL' })
    expect(body.errorDetails).toMatch(/expected string/)
  })

  it('returns 400 PARSE_ERROR for invalid JSON', async () => {
    const response = await single('banner-text', '{"context":')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      key: 'banner-text',
      errorCode: 'PARSE_ERROR',
      errorDetails: 'Request body is not valid JSON',
    })
  })

  it('returns 400 INVALID_CONTEXT for malformed contexts', async () => {
    for (const body of [
      { context: [] },
      { context: 'user-1' },
      { context: null },
      { context: { targetingKey: 42 } },
      [1],
    ]) {
      const response = await single('banner-text', body)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        key: 'banner-text',
        errorCode: 'INVALID_CONTEXT',
      })
    }
  })

  it('returns 500 with errorDetails on unexpected failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // A key whose metadata points at a malformed environment id makes the ruleset query fail.
    const key = await createFixtureSdkKey(seed.project.projectId, 'not-a-uuid')
    const response = await single(
      'banner-text',
      { context: {} },
      { authorization: `Bearer ${key}` },
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ errorDetails: 'Internal server error' })
  })
})

describe('authentication', () => {
  const unauthenticated = async (headers: Record<string, string>) => {
    const response = await handleSingleEvaluation(
      new Request(`${BASE}/ofrep/v1/evaluate/flags/banner-text`, {
        method: 'POST',
        headers,
        body: '{"context":{}}',
      }),
      'banner-text',
    )
    expect(response.status).toBe(401)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({ errorCode: 'GENERAL', errorDetails: expect.any(String) })
    return body
  }

  it('rejects a missing key', async () => {
    await unauthenticated({})
  })

  it('rejects keys with the wrong prefix', async () => {
    const body = await unauthenticated({ authorization: 'Bearer hal_mgmt_abcdef' })
    expect(body.errorDetails).toMatch(/SDK key/)
  })

  it('rejects unknown keys', async () => {
    await unauthenticated({ authorization: 'Bearer hal_sdk_doesnotexist' })
  })

  it('accepts the X-API-Key header', async () => {
    const response = await handleSingleEvaluation(
      new Request(`${BASE}/ofrep/v1/evaluate/flags/banner-text`, {
        method: 'POST',
        headers: { 'x-api-key': seed.key },
        body: '{"context":{}}',
      }),
      'banner-text',
    )
    expect(response.status).toBe(200)
  })

  it('rejects revoked keys once the verification cache is cleared', async () => {
    expect((await single('banner-text', { context: {} })).status).toBe(200)
    await db
      .update(apikey)
      .set({ enabled: false })
      .where(eq(apikey.referenceId, seed.project.projectId))
    clearApiKeyCache()
    const response = await single('banner-text', { context: {} })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ errorCode: 'GENERAL' })
  })

  it('rejects keys whose environment was deleted', async () => {
    const devId = seed.project.environments.development!.id
    const key = await createFixtureSdkKey(seed.project.projectId, devId)
    await db.delete(environments).where(eq(environments.id, devId))
    const response = await handleBulkEvaluation(
      new Request(`${BASE}/ofrep/v1/evaluate/flags`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: '{}',
      }),
    )
    expect(response.status).toBe(401)
  })

  it('rejects bulk requests without a key', async () => {
    const response = await handleBulkEvaluation(
      new Request(`${BASE}/ofrep/v1/evaluate/flags`, { method: 'POST', body: '{}' }),
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ errorCode: 'GENERAL' })
  })
})

describe('POST /ofrep/v1/evaluate/flags', () => {
  it('evaluates every non-archived flag, with failures inline', async () => {
    const response = await bulk({ context: { targetingKey: 'u1', email: 'ada@acme.io' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{32}\.[0-9a-f]{32}"$/)
    expect(response.headers.get('cache-control')).toBe('private, must-revalidate')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-expose-headers')).toBe('ETag')
    const body = (await response.json()) as { flags: Array<Record<string, unknown>> }
    const byKey = Object.fromEntries(body.flags.map((flag) => [flag.key, flag]))
    expect(Object.keys(byKey).sort()).toEqual([
      'banner-text',
      'broken',
      'kill-switch',
      'new-checkout',
      'pricing-test',
    ])
    expect(byKey['new-checkout']).toEqual({
      key: 'new-checkout',
      value: true,
      reason: 'TARGETING_MATCH',
      variant: 'on',
      metadata: { ruleId: 'internal' },
    })
    expect(byKey['kill-switch']).toEqual({
      key: 'kill-switch',
      value: false,
      reason: 'DISABLED',
      variant: 'off',
    })
    expect(byKey.broken).toMatchObject({
      key: 'broken',
      errorCode: 'GENERAL',
      errorDetails: expect.any(String),
    })
    expect(byKey['pricing-test']).toMatchObject({
      reason: 'SPLIT',
      metadata: { experimentKey: 'pricing-q4' },
    })
  })

  it('reports per-flag TARGETING_KEY_MISSING without failing the request', async () => {
    const response = await bulk({ context: {} })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { flags: Array<Record<string, unknown>> }
    expect(body.flags.find((flag) => flag.key === 'new-checkout')).toMatchObject({
      errorCode: 'TARGETING_KEY_MISSING',
    })
  })

  it('answers 304 for the same context and a new ETag for a different context', async () => {
    const first = await bulk({
      context: { targetingKey: 'u1', plan: 'free', nested: { a: 1, b: 2 } },
    })
    const etag = first.headers.get('etag')!
    expect(etag).toBeTruthy()

    // Same context with a different key order.
    const same = await bulk(
      { context: { nested: { b: 2, a: 1 }, plan: 'free', targetingKey: 'u1' } },
      { 'if-none-match': etag },
    )
    expect(same.status).toBe(304)
    expect(same.headers.get('etag')).toBe(etag)
    expect(same.headers.get('access-control-allow-origin')).toBe('*')
    expect(await same.text()).toBe('')

    // Weak comparison and lists are accepted.
    const listed = await bulk(
      { context: { targetingKey: 'u1', plan: 'free', nested: { a: 1, b: 2 } } },
      { 'if-none-match': `"other", W/${etag}` },
    )
    expect(listed.status).toBe(304)

    const other = await bulk(
      { context: { targetingKey: 'u2', plan: 'free', nested: { a: 1, b: 2 } } },
      { 'if-none-match': etag },
    )
    expect(other.status).toBe(200)
    expect(other.headers.get('etag')).not.toBe(etag)
  })

  it('changes the ETag after a configuration change', async () => {
    const context = { context: { targetingKey: 'u1' } }
    const etag = (await bulk(context)).headers.get('etag')!
    await db
      .update(flagEnvironments)
      .set({ enabled: true })
      .where(
        and(
          eq(flagEnvironments.flagId, seed.flagIds['kill-switch']!),
          eq(flagEnvironments.environmentId, seed.envId),
        ),
      )
    invalidateEnvironment(seed.envId)
    const response = await bulk(context, { 'if-none-match': etag })
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).not.toBe(etag)
    const body = (await response.json()) as { flags: Array<Record<string, unknown>> }
    expect(body.flags.find((flag) => flag.key === 'kill-switch')).toMatchObject({
      value: true,
      reason: 'STATIC',
    })
  })

  it('returns bulk failures without a key for invalid requests', async () => {
    const parse = await bulk('not json')
    expect(parse.status).toBe(400)
    expect(await parse.json()).toEqual({
      errorCode: 'PARSE_ERROR',
      errorDetails: 'Request body is not valid JSON',
    })

    const invalid = await bulk({ context: { targetingKey: ['a'] } })
    expect(invalid.status).toBe(400)
    const body = (await invalid.json()) as Record<string, unknown>
    expect(body).toMatchObject({ errorCode: 'INVALID_CONTEXT' })
    expect(body).not.toHaveProperty('key')
  })
})

describe('CORS', () => {
  it('answers preflight requests', () => {
    const response = ofrepPreflight()
    expect(response.status).toBe(204)
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type, If-None-Match, X-API-Key',
      'access-control-expose-headers': 'ETag',
    })
  })
})

describe('GET /ofrep/v1/configuration', () => {
  it('describes the provider capabilities with ETag support', async () => {
    const get = (headers: Record<string, string> = {}) =>
      handleConfiguration(
        new Request(`${BASE}/ofrep/v1/configuration`, {
          headers: { authorization: `Bearer ${seed.key}`, ...headers },
        }),
      )
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      name: 'Halyard',
      capabilities: {
        cacheInvalidation: { polling: { enabled: true, minPollingIntervalMs: 5000 } },
        flagEvaluation: { supportedTypes: ['boolean', 'string', 'int', 'float', 'object'] },
      },
    })
    const etag = response.headers.get('etag')!
    expect((await get({ 'if-none-match': etag })).status).toBe(304)
    const anonymous = await handleConfiguration(new Request(`${BASE}/ofrep/v1/configuration`))
    expect(anonymous.status).toBe(401)
  })
})

describe('GET /api/v1/ruleset', () => {
  it('returns the ruleset with ETag support and no CORS headers', async () => {
    const get = (headers: Record<string, string> = {}) =>
      handleRuleset(
        new Request(`${BASE}/api/v1/ruleset`, {
          headers: { authorization: `Bearer ${seed.key}`, ...headers },
        }),
      )
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    const etag = response.headers.get('etag')!
    expect(etag).toMatch(/^W\/"[0-9a-f]{32}"$/)
    const ruleset = (await response.json()) as {
      version: number
      projectKey: string
      environmentKey: string
      flags: Record<string, unknown>
      segments: Record<string, unknown>
    }
    expect(ruleset).toMatchObject({ version: 1, projectKey: 'shop', environmentKey: 'production' })
    expect(Object.keys(ruleset.flags).sort()).toEqual([
      'banner-text',
      'broken',
      'kill-switch',
      'new-checkout',
      'pricing-test',
    ])
    expect(Object.keys(ruleset.segments)).toEqual(['beta-testers'])

    const cached = await get({ 'if-none-match': etag })
    expect(cached.status).toBe(304)
    expect(await cached.text()).toBe('')

    const anonymous = await handleRuleset(new Request(`${BASE}/api/v1/ruleset`))
    expect(anonymous.status).toBe(401)
  })
})

describe('tracking', () => {
  it('records experiment exposures after a flush', async () => {
    const response = await single('pricing-test', { context: { targetingKey: 'subject-1' } })
    const body = (await response.json()) as {
      variant: string
      reason: string
      metadata: Record<string, string>
    }
    expect(body.reason).toBe('SPLIT')
    expect(body.metadata.experimentKey).toBe('pricing-q4')
    // A second evaluation of the same subject is deduplicated.
    await single('pricing-test', { context: { targetingKey: 'subject-1' } })
    await flushTracking()

    const rows = await db
      .select()
      .from(experimentExposures)
      .where(eq(experimentExposures.experimentId, seed.experimentId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      subjectHash: createHash('sha256').update('subject-1').digest('hex'),
      variant: body.variant,
    })
  })

  it('updates evaluation stats with sameVariantSince semantics', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const at = (iso: string) => {
      vi.setSystemTime(new Date(iso))
      return new Date(iso).getTime()
    }
    const internal = { context: { targetingKey: 'u1', email: 'ada@acme.io' } } // → on
    const beta = { context: { targetingKey: 'u2', plan: 'beta' } } // → on
    const flagId = seed.flagIds['new-checkout']!
    const read = async () => {
      await flushTracking()
      const [row] = await db
        .select()
        .from(flagEvaluationStats)
        .where(
          and(
            eq(flagEvaluationStats.flagId, flagId),
            eq(flagEvaluationStats.environmentId, seed.envId),
          ),
        )
      return row!
    }
    const disabled = async () => {
      // Turn the flag off: every evaluation now returns "off".
      await db
        .update(flagEnvironments)
        .set({ enabled: false })
        .where(
          and(eq(flagEnvironments.flagId, flagId), eq(flagEnvironments.environmentId, seed.envId)),
        )
      invalidateEnvironment(seed.envId)
    }

    // Window 1: on, then off → the run of "off" started with the last evaluation.
    at('2030-01-01T10:00:00Z')
    await single('new-checkout', internal)
    await disabled()
    const t2 = at('2030-01-01T10:00:02Z')
    await single('new-checkout', internal)
    let row = await read()
    expect(row.evaluationCount).toBe(2)
    expect(row.lastVariant).toBe('off')
    expect(row.lastEvaluatedAt.getTime()).toBe(t2)
    expect(row.sameVariantSince.getTime()).toBe(t2)

    // Window 2: only "off" → unchanged.
    at('2030-01-01T10:00:10Z')
    await single('new-checkout', beta)
    const t4 = at('2030-01-01T10:00:12Z')
    await single('new-checkout', internal)
    row = await read()
    expect(row.evaluationCount).toBe(4)
    expect(row.lastEvaluatedAt.getTime()).toBe(t4)
    expect(row.sameVariantSince.getTime()).toBe(t2)

    // Window 3: an error (no variant) does not break the run.
    at('2030-01-01T10:00:20Z')
    await db
      .update(flagEnvironments)
      .set({ enabled: true })
      .where(
        and(eq(flagEnvironments.flagId, flagId), eq(flagEnvironments.environmentId, seed.envId)),
      )
    invalidateEnvironment(seed.envId)
    expect((await single('new-checkout', { context: {} })).status).toBe(400)
    row = await read()
    expect(row.evaluationCount).toBe(5)
    expect(row.lastVariant).toBe('off')
    expect(row.sameVariantSince.getTime()).toBe(t2)

    // Window 4: a different variant → the run restarts.
    const t6 = at('2030-01-01T10:00:30Z')
    await single('new-checkout', internal)
    row = await read()
    expect(row.lastVariant).toBe('on')
    expect(row.sameVariantSince.getTime()).toBe(t6)
  })
})

describe('metrics', () => {
  it('counts evaluations by configuration labels only', async () => {
    await single('new-checkout', { context: { targetingKey: 'secret-user', email: 'ada@acme.io' } })
    await single('missing-flag-xyz', { context: { targetingKey: 'secret-user' } })
    const text = await registry.metrics()
    expect(text).toMatch(
      /halyard_evaluations_total\{project="shop",environment="production",flag="new-checkout",variant="on",reason="TARGETING_MATCH"\} \d+/,
    )
    expect(text).toMatch(/halyard_evaluations_total\{[^}]*flag="_unknown"[^}]*reason="ERROR"\}/)
    expect(text).not.toContain('secret-user')
    expect(text).not.toContain('missing-flag-xyz')
    expect(text).not.toContain('acme.io')
    expect(text).toMatch(
      /halyard_ofrep_request_duration_seconds_count\{endpoint="single",status="200"\} \d+/,
    )
    expect(text).toMatch(/halyard_ruleset_cache_hits_total \d+/)
    expect(text).toMatch(/halyard_ruleset_cache_misses_total \d+/)
    expect(text).toContain('process_cpu_user_seconds_total')
  })
})
