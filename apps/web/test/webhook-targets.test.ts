import type { LookupAddress } from 'node:dns'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertAllowedWebhookTarget,
  isPrivateAddress,
  PRIVATE_TARGET_ERROR,
  pinnedLookup,
  privateNetworksBlocked,
  type WebhookResolver,
} from '@/server/services/webhook-targets'

afterEach(() => {
  delete process.env.WEBHOOK_BLOCK_PRIVATE_NETWORKS
})

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '[::1]',
    'fe80::1',
    'fe80::1%en0',
    'febf:ffff::1',
    'fc00::1',
    'fd12:3456:789a::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '2002:c0a8:101::1',
    'ff02::1',
  ])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '169.253.1.1',
    '192.169.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4001:80b::200e',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1',
    'example.com',
    '',
    'not-an-ip',
    '999.1.1.1',
  ])('treats %s as public (or not an address)', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })
})

const resolveTo =
  (...addresses: string[]): WebhookResolver =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))

const failingResolver: WebhookResolver = async () => {
  throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
}

describe('assertAllowedWebhookTarget', () => {
  it('does nothing (and resolves nothing) when the guard is off', async () => {
    expect(privateNetworksBlocked()).toBe(false)
    await expect(
      assertAllowedWebhookTarget('http://127.0.0.1/hook', { resolver: failingResolver }),
    ).resolves.toBeNull()
    await expect(
      assertAllowedWebhookTarget('http://internal.svc/hook', {
        enabled: false,
        resolver: failingResolver,
      }),
    ).resolves.toBeNull()
  })

  it('reads WEBHOOK_BLOCK_PRIVATE_NETWORKS', async () => {
    process.env.WEBHOOK_BLOCK_PRIVATE_NETWORKS = 'true'
    expect(privateNetworksBlocked()).toBe(true)
    await expect(assertAllowedWebhookTarget('http://127.0.0.1/hook')).rejects.toMatchObject({
      status: 400,
      message: PRIVATE_TARGET_ERROR,
    })
    process.env.WEBHOOK_BLOCK_PRIVATE_NETWORKS = 'false'
    expect(privateNetworksBlocked()).toBe(false)
  })

  it.each([
    'http://localhost/hook',
    'http://localhost./hook',
    'http://api.localhost:3000/hook',
    'http://127.0.0.1:8080/hook',
    'http://2130706433/hook',
    'http://0x7f.1/hook',
    'http://[::1]/hook',
    'http://[::ffff:127.0.0.1]/hook',
    'https://10.0.0.5/hook',
    'http://169.254.169.254/latest/meta-data',
    'http://[fd00::1]/hook',
  ])('rejects %s', async (url) => {
    await expect(
      assertAllowedWebhookTarget(url, { enabled: true, resolver: resolveTo('93.184.216.34') }),
    ).rejects.toMatchObject({ status: 400, reason: 'private', message: PRIVATE_TARGET_ERROR })
  })

  it('rejects schemes other than http(s)', async () => {
    await expect(
      assertAllowedWebhookTarget('ftp://example.com/hook', { enabled: true }),
    ).rejects.toMatchObject({ status: 400, reason: 'scheme' })
    await expect(
      assertAllowedWebhookTarget('file:///etc/passwd', { enabled: true }),
    ).rejects.toMatchObject({ status: 400, reason: 'scheme' })
  })

  it('rejects host names when any resolved address is private', async () => {
    await expect(
      assertAllowedWebhookTarget('https://hooks.example.com/x', {
        enabled: true,
        resolver: resolveTo('10.0.0.5'),
      }),
    ).rejects.toMatchObject({ reason: 'private' })
    await expect(
      assertAllowedWebhookTarget('https://hooks.example.com/x', {
        enabled: true,
        resolver: resolveTo('93.184.216.34', '2606:4700::1', 'fd00::1'),
      }),
    ).rejects.toMatchObject({ reason: 'private' })
  })

  it('returns the vetted addresses of allowed targets', async () => {
    await expect(
      assertAllowedWebhookTarget('https://hooks.example.com/x', {
        enabled: true,
        resolver: resolveTo('93.184.216.34', '2606:4700::1'),
      }),
    ).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1', family: 6 },
    ])
    await expect(
      assertAllowedWebhookTarget('http://8.8.8.8:8080/x', {
        enabled: true,
        resolver: failingResolver,
      }),
    ).resolves.toEqual([{ address: '8.8.8.8', family: 4 }])
  })

  it('reports host names that do not resolve', async () => {
    await expect(
      assertAllowedWebhookTarget('https://nowhere.example/x', {
        enabled: true,
        resolver: failingResolver,
      }),
    ).rejects.toMatchObject({ status: 400, reason: 'unresolvable' })
    await expect(
      assertAllowedWebhookTarget('https://nowhere.example/x', {
        enabled: true,
        resolver: resolveTo(),
      }),
    ).rejects.toMatchObject({ reason: 'unresolvable' })
  })
})

describe('pinnedLookup', () => {
  const addresses: LookupAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700::1', family: 6 },
  ]
  const call = (options: unknown) =>
    new Promise<{ error: unknown; address: unknown; family: unknown }>((resolve) =>
      pinnedLookup(addresses)('anything.example', options, (error, address, family) =>
        resolve({ error, address, family }),
      ),
    )

  it('only ever returns the vetted addresses', async () => {
    expect(await call({ all: true })).toMatchObject({ error: null, address: addresses })
    expect(await call({})).toMatchObject({ error: null, address: '93.184.216.34', family: 4 })
    expect(await call({ family: 6 })).toMatchObject({ address: '2606:4700::1', family: 6 })
    expect(await call({ all: true, family: 6 })).toMatchObject({ address: [addresses[1]] })
  })

  it('fails when no vetted address has the requested family', async () => {
    const result = await new Promise<{ error: unknown }>((resolve) =>
      pinnedLookup([{ address: '93.184.216.34', family: 4 }])('x', { family: 6 }, (error) =>
        resolve({ error }),
      ),
    )
    expect(result.error).toMatchObject({ code: 'ENOTFOUND' })
  })
})
