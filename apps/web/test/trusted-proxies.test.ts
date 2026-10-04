import { describe, expect, it } from 'vitest'
import { ipAddressOptions, parseTrustedProxies } from '@/lib/trusted-proxies'

describe('parseTrustedProxies', () => {
  it('splits a comma separated list and trims whitespace', () => {
    expect(parseTrustedProxies('10.0.0.1, 192.168.0.0/16 ,fd00::/8')).toEqual([
      '10.0.0.1',
      '192.168.0.0/16',
      'fd00::/8',
    ])
  })

  it('returns an empty list for unset or blank values', () => {
    expect(parseTrustedProxies(undefined)).toEqual([])
    expect(parseTrustedProxies('  ')).toEqual([])
  })
})

describe('ipAddressOptions', () => {
  it('does not trust forwarding headers when no proxy is configured', () => {
    expect(ipAddressOptions([])).toEqual({ ipAddressHeaders: [] })
  })

  it('reads forwarded headers only through the configured proxies', () => {
    expect(ipAddressOptions(['10.0.0.1'])).toEqual({
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      trustedProxies: ['10.0.0.1'],
    })
  })
})
