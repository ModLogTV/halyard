import { OFREPProvider } from '@openfeature/ofrep-provider'
import { OFREPWebProvider } from '@openfeature/ofrep-web-provider'
import { OpenFeature as ServerOpenFeature } from '@openfeature/server-sdk'
import { OpenFeature as WebOpenFeature } from '@openfeature/web-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleBulkEvaluation, handleSingleEvaluation } from '@/server/ofrep/handler'
import {
  createFixtureFlag,
  createFixtureProject,
  createFixtureSdkKey,
  truncateAll,
} from './fixtures'

/**
 * Verifies the OFREP endpoints against the official OpenFeature providers. The
 * providers talk to `http://halyard.test`; a fetch shim routes their requests to the
 * handler functions, so every request goes through the real protocol code.
 */
const BASE_URL = 'http://halyard.test'

interface Exchange {
  path: string
  ifNoneMatch: string | null
  status: number
  etag: string | null
}

const exchanges: Exchange[] = []
let sdkKey: string

async function dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init)
  const { pathname } = new URL(request.url)
  let response: Response
  if (pathname === '/ofrep/v1/evaluate/flags') {
    response = await handleBulkEvaluation(request)
  } else {
    const match = /^\/ofrep\/v1\/evaluate\/flags\/([^/]+)$/.exec(pathname)
    response = match?.[1]
      ? await handleSingleEvaluation(request, decodeURIComponent(match[1]))
      : new Response('not found', { status: 404 })
  }
  exchanges.push({
    path: pathname,
    ifNoneMatch: request.headers.get('if-none-match'),
    status: response.status,
    etag: response.headers.get('etag'),
  })
  return response
}

beforeAll(async () => {
  await truncateAll()
  const project = await createFixtureProject({ slug: 'sdk-shop' })
  const envId = project.environments.production!.id
  await createFixtureFlag({
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
        ],
        fallthrough: {
          type: 'rollout',
          variations: [
            { variant: 'on', weight: 30 },
            { variant: 'off', weight: 70 },
          ],
        },
      },
    },
  })
  await createFixtureFlag({
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
  await createFixtureFlag({
    projectId: project.projectId,
    key: 'max-items',
    type: 'number',
    variants: [
      { key: 'few', value: 2.5 },
      { key: 'many', value: 50 },
    ],
    environments: {
      [envId]: {
        offVariant: 'few',
        rules: [
          {
            id: 'pro',
            conditions: [{ type: 'attribute', attribute: 'plan', operator: 'eq', value: 'pro' }],
            serve: { type: 'variant', variant: 'many' },
          },
        ],
        fallthrough: { type: 'variant', variant: 'few' },
      },
    },
  })
  await createFixtureFlag({
    projectId: project.projectId,
    key: 'theme',
    type: 'json',
    variants: [
      { key: 'teal', value: { color: 'teal', radius: 4, tags: ['a', 'b'] } },
      { key: 'plain', value: { color: 'gray' } },
    ],
    environments: {
      [envId]: {
        enabled: false,
        offVariant: 'plain',
        fallthrough: { type: 'variant', variant: 'teal' },
      },
    },
  })
  sdkKey = await createFixtureSdkKey(project.projectId, envId)
})

describe('@openfeature/ofrep-provider (server, single evaluation)', () => {
  beforeAll(async () => {
    const provider = new OFREPProvider({
      baseUrl: BASE_URL,
      headers: [['Authorization', `Bearer ${sdkKey}`]],
      fetchImplementation: dispatch,
    })
    await ServerOpenFeature.setProviderAndWait(provider)
  })

  afterAll(async () => {
    await ServerOpenFeature.close()
  })

  const client = () => ServerOpenFeature.getClient()

  it('resolves a boolean rule match', async () => {
    const details = await client().getBooleanDetails('new-checkout', false, {
      targetingKey: 'user-1',
      email: 'ada@acme.io',
    })
    expect(details).toMatchObject({
      value: true,
      variant: 'on',
      reason: 'TARGETING_MATCH',
      flagMetadata: { ruleId: 'internal' },
    })
    expect(details.errorCode).toBeUndefined()
  })

  it('resolves a sticky boolean rollout', async () => {
    const first = await client().getBooleanDetails('new-checkout', false, {
      targetingKey: 'user-77',
    })
    const second = await client().getBooleanDetails('new-checkout', true, {
      targetingKey: 'user-77',
    })
    expect(first.reason).toBe('SPLIT')
    expect(['on', 'off']).toContain(first.variant)
    expect(first.value).toBe(first.variant === 'on')
    expect(second).toMatchObject({ value: first.value, variant: first.variant, reason: 'SPLIT' })
  })

  it('resolves a string flag', async () => {
    const details = await client().getStringDetails('banner-text', 'default')
    expect(details).toMatchObject({ value: 'Hello', variant: 'hello', reason: 'STATIC' })
  })

  it('resolves a number flag', async () => {
    expect(await client().getNumberDetails('max-items', 0, { plan: 'pro' })).toMatchObject({
      value: 50,
      variant: 'many',
      reason: 'TARGETING_MATCH',
    })
    expect(await client().getNumberDetails('max-items', 0)).toMatchObject({
      value: 2.5,
      variant: 'few',
      reason: 'STATIC',
    })
  })

  it('resolves a json flag', async () => {
    const details = await client().getObjectDetails('theme', {})
    expect(details).toMatchObject({
      value: { color: 'gray' },
      variant: 'plain',
      reason: 'DISABLED',
    })
  })

  it('returns the default value with FLAG_NOT_FOUND', async () => {
    const details = await client().getBooleanDetails('does-not-exist', true)
    expect(details).toMatchObject({ value: true, reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND' })
  })

  it('returns the default value with TARGETING_KEY_MISSING', async () => {
    const details = await client().getBooleanDetails('new-checkout', false, { plan: 'free' })
    expect(details).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'TARGETING_KEY_MISSING',
    })
    expect(details.errorMessage).toMatch(/targetingKey/)
  })

  it('reports TYPE_MISMATCH when the caller expects another type', async () => {
    const details = await client().getStringDetails('new-checkout', 'fallback', {
      targetingKey: 'u',
      email: 'a@acme.io',
    })
    expect(details).toMatchObject({
      value: 'fallback',
      reason: 'ERROR',
      errorCode: 'TYPE_MISMATCH',
    })
  })
})

describe('@openfeature/ofrep-web-provider (client, bulk evaluation)', () => {
  beforeAll(async () => {
    exchanges.length = 0
    const provider = new OFREPWebProvider({
      baseUrl: BASE_URL,
      headers: [['Authorization', `Bearer ${sdkKey}`]],
      fetchImplementation: dispatch,
      // Node has no localStorage, document or EventSource; polling is driven by the test.
      cacheMode: 'disabled',
      changeDetection: 'none',
      pollInterval: 0,
    })
    await WebOpenFeature.setContext({ targetingKey: 'user-1' })
    await WebOpenFeature.setProviderAndWait(provider)
  })

  afterAll(async () => {
    await WebOpenFeature.close()
  })

  const client = () => WebOpenFeature.getClient()

  it('serves all flag types from one bulk request', () => {
    expect(exchanges.map((e) => [e.path, e.status])).toEqual([['/ofrep/v1/evaluate/flags', 200]])
    const checkout = client().getBooleanDetails('new-checkout', true)
    expect(checkout.reason).toBe('SPLIT')
    expect(checkout.value).toBe(checkout.variant === 'on')
    expect(client().getStringDetails('banner-text', 'x')).toMatchObject({
      value: 'Hello',
      reason: 'STATIC',
    })
    expect(client().getNumberDetails('max-items', 0)).toMatchObject({ value: 2.5, variant: 'few' })
    expect(client().getObjectDetails('theme', {})).toMatchObject({
      value: { color: 'gray' },
      reason: 'DISABLED',
    })
    expect(client().getBooleanDetails('does-not-exist', true)).toMatchObject({
      value: true,
      errorCode: 'FLAG_NOT_FOUND',
    })
  })

  it('re-evaluates when attributes change for the same targeting key', async () => {
    // The provider keeps its ETag when only attributes change, so the ETag must cover the context.
    await WebOpenFeature.setContext({ targetingKey: 'user-1', email: 'ada@acme.io', plan: 'pro' })
    const last = exchanges.at(-1)!
    expect(last.ifNoneMatch).toBe(exchanges[0]!.etag)
    expect(last.status).toBe(200)
    expect(last.etag).not.toBe(exchanges[0]!.etag)
    expect(client().getBooleanDetails('new-checkout', false)).toMatchObject({
      value: true,
      reason: 'TARGETING_MATCH',
    })
    expect(client().getNumberDetails('max-items', 0)).toMatchObject({ value: 50, variant: 'many' })
  })

  it('receives 304 when nothing changed', async () => {
    const before = exchanges.length
    await WebOpenFeature.setContext({ plan: 'pro', email: 'ada@acme.io', targetingKey: 'user-1' })
    expect(exchanges.length).toBe(before + 1)
    const last = exchanges.at(-1)!
    expect(last.status).toBe(304)
    expect(client().getBooleanDetails('new-checkout', false).value).toBe(true)
  })

  it('surfaces TARGETING_KEY_MISSING per flag', async () => {
    await WebOpenFeature.setContext({ plan: 'free' })
    expect(client().getBooleanDetails('new-checkout', false)).toMatchObject({
      value: false,
      reason: 'ERROR',
      errorCode: 'TARGETING_KEY_MISSING',
    })
    expect(client().getStringDetails('banner-text', 'x').value).toBe('Hello')
  })
})
