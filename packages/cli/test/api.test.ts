import { describe, expect, it } from 'vitest'
import { createClient, errorFromResponse, networkError } from '../src/api.js'
import { ExitCode } from '../src/errors.js'
import { fakeFetch, json } from './helpers.js'

const project = {
  id: 'p1',
  name: 'Acme',
  slug: 'acme',
  description: null,
  environments: [],
}

function clientFor(route: Parameters<typeof fakeFetch>[0], extra: { timeoutMs?: number } = {}) {
  const { fetch, requests } = fakeFetch(route)
  const client = createClient({
    url: 'https://flags.example.com/',
    key: 'hal_mgmt_secret',
    fetch,
    userAgent: 'halyard-cli/test',
    ...extra,
  })
  return { client, requests }
}

describe('client requests', () => {
  it('sends the bearer token and hits the documented endpoints', async () => {
    const { client, requests } = clientFor((req) => {
      if (req.url.endsWith('/api/v1/projects/current')) return json(project)
      if (req.url.endsWith('/api/v1/flags')) return json({ flags: [] })
      if (req.url.endsWith('/api/v1/export')) return json({ version: 1 })
      if (req.url.includes('/api/v1/export/flagd')) return json({ flagd: {}, warnings: [] })
      return undefined
    })
    await client.currentProject()
    await client.listFlags()
    await client.exportDocument()
    await client.exportFlagd('prod uction')
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://flags.example.com/api/v1/projects/current',
      'GET https://flags.example.com/api/v1/flags',
      'GET https://flags.example.com/api/v1/export',
      'GET https://flags.example.com/api/v1/export/flagd?environment=prod+uction',
    ])
    for (const request of requests) {
      expect(request.headers.authorization).toBe('Bearer hal_mgmt_secret')
      expect(request.headers['user-agent']).toBe('halyard-cli/test')
      expect(request.headers.accept).toBe('application/json')
    }
  })

  it('posts the import body as JSON', async () => {
    const { client, requests } = clientFor(() =>
      json({ diff: {}, errors: [], warnings: [], applied: false }),
    )
    await client.importDocument({ document: { version: 1 }, prune: true, dryRun: true })
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://flags.example.com/api/v1/import',
      body: { document: { version: 1 }, prune: true, dryRun: true },
    })
    expect(requests[0]?.headers['content-type']).toBe('application/json')
  })

  it('rejects responses that are not JSON objects', async () => {
    const { client } = clientFor(() => new Response('<html>hi</html>', { status: 200 }))
    await expect(client.currentProject()).rejects.toMatchObject({
      exitCode: ExitCode.Config,
      message: expect.stringContaining('expected JSON'),
    })
  })

  it('rejects a flags response without flags', async () => {
    const { client } = clientFor(() => json({}))
    await expect(client.listFlags()).rejects.toThrow(/missing "flags"/)
  })
})

describe('error mapping', () => {
  const ctx = { method: 'GET', path: '/api/v1/flags', url: 'https://flags.example.com' }

  it('401 means an invalid key (exit 2)', () => {
    const error = errorFromResponse(401, { error: 'unauthorized', message: 'x' }, ctx)
    expect(error.message).toBe('Invalid management key.')
    expect(error.exitCode).toBe(ExitCode.Config)
  })

  it('403 on writes explains how to get a write key', () => {
    const error = errorFromResponse(
      403,
      { error: 'forbidden', message: 'read only' },
      { ...ctx, method: 'POST' },
    )
    expect(error.message).toContain(
      'This key cannot write; create a key with write access in Settings → API keys',
    )
    expect(error.exitCode).toBe(ExitCode.Config)
  })

  it('403 on reads shows the server message', () => {
    const error = errorFromResponse(
      403,
      { error: 'forbidden', message: 'No access to this project' },
      ctx,
    )
    expect(error.message).toBe('No access to this project')
  })

  it('400 and 404 JSON errors are validation errors with the server message', () => {
    expect(
      errorFromResponse(400, { error: 'bad_request', message: 'Bad flag' }, ctx),
    ).toMatchObject({
      message: 'Bad flag',
      exitCode: ExitCode.Validation,
    })
    expect(
      errorFromResponse(404, { error: 'not_found', message: 'No such flag' }, ctx),
    ).toMatchObject({
      message: 'No such flag',
      exitCode: ExitCode.Validation,
    })
  })

  it('a 404 without an API error body means the URL is wrong', () => {
    const error = errorFromResponse(404, undefined, ctx)
    expect(error.message).toContain('does not serve the Halyard REST API')
    expect(error.hint).toContain('--url')
  })

  it('5xx is reported as a network-class failure', () => {
    const error = errorFromResponse(500, { error: 'internal', message: 'boom' }, ctx)
    expect(error.exitCode).toBe(ExitCode.Network)
    expect(error.message).toContain('500: boom')
  })

  it('maps HTTP errors end to end', async () => {
    const { client } = clientFor(() => json({ error: 'unauthorized', message: 'nope' }, 401))
    await expect(client.currentProject()).rejects.toMatchObject({
      message: 'Invalid management key.',
    })
  })
})

describe('network errors', () => {
  const url = 'https://flags.example.com'

  it('explains connection refused and hints at --url', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), {
      code: 'ECONNREFUSED',
    })
    const error = networkError(new TypeError('fetch failed', { cause }), url, 30_000)
    expect(error.exitCode).toBe(ExitCode.Network)
    expect(error.message).toContain('connection refused')
    expect(error.hint).toContain('--url')
  })

  it('finds the code inside aggregate errors (dual-stack hosts)', () => {
    const aggregate = new AggregateError([
      Object.assign(new Error('a'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('b'), { code: 'ECONNREFUSED' }),
    ])
    const error = networkError(new TypeError('fetch failed', { cause: aggregate }), url, 1000)
    expect(error.message).toContain('connection refused')
  })

  it('recognises Bun connection errors', () => {
    const error = networkError(
      Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' }),
      url,
      1000,
    )
    expect(error.message).toContain('connection refused')
  })

  it('explains DNS failures and TLS problems', () => {
    const dns = networkError(
      new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ENOTFOUND' }) }),
      url,
      1000,
    )
    expect(dns.message).toContain('Could not resolve')
    const tls = networkError(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error(), { code: 'CERT_HAS_EXPIRED' }),
      }),
      url,
      1000,
    )
    expect(tls.message).toContain('TLS certificate')
    expect(tls.hint).toContain('NODE_EXTRA_CA_CERTS')
  })

  it('falls back to the underlying message', () => {
    const error = networkError(new Error('socket hang up'), url, 1000)
    expect(error.message).toContain('socket hang up')
    expect(error.exitCode).toBe(ExitCode.Network)
  })

  it('times out slow servers', async () => {
    const { client } = clientFor(() => undefined, { timeoutMs: 20 })
    const slow = createClient({
      url,
      key: 'k',
      timeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    })
    await expect(slow.currentProject()).rejects.toMatchObject({
      exitCode: ExitCode.Network,
      message: expect.stringContaining('timed out'),
    })
    expect(client).toBeDefined()
  })

  it('wraps rejections of the injected fetch', async () => {
    const client = createClient({
      url,
      key: 'k',
      fetch: async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
        })
      },
    })
    await expect(client.listFlags()).rejects.toMatchObject({ exitCode: ExitCode.Network })
  })
})
