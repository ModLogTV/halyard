import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { HttpError } from '@/server/errors'

/**
 * Optional SSRF guard for webhook URLs.
 *
 * Self-hosted installations legitimately send webhooks to cluster-internal services,
 * so the guard is off by default. Multi-tenant instances should set
 * `WEBHOOK_BLOCK_PRIVATE_NETWORKS=true`: webhook URLs (when saved and again before
 * every delivery) must then not point to loopback, private, link-local, CGNAT,
 * unique-local or otherwise non-public addresses, and the delivery connection is
 * pinned to the addresses that were checked (no DNS rebinding between check and
 * connect).
 */
export const PRIVATE_TARGET_ERROR = 'Target resolves to a private address'

export function privateNetworksBlocked(): boolean {
  const value = process.env.WEBHOOK_BLOCK_PRIVATE_NETWORKS?.trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes'
}

export type WebhookResolver = (hostname: string) => Promise<LookupAddress[]>

const systemResolver: WebhookResolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true })

/** Raised when a webhook target is not allowed (`private`) or cannot be resolved. */
export class WebhookTargetError extends HttpError {
  readonly reason: 'private' | 'scheme' | 'unresolvable'

  constructor(reason: WebhookTargetError['reason'], message: string) {
    super(400, 'WEBHOOK_TARGET_NOT_ALLOWED', message)
    this.reason = reason
  }
}

// Address classification -----------------------------------------------------------

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN))
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null
}

function isPrivateIPv4([a = 0, b = 0]: number[]): boolean {
  return (
    a === 0 || // "this network", includes the unspecified 0.0.0.0
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0/24 IETF protocol assignments (and 192.0.2/24 docs)
    (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18/15
    a >= 224 // multicast 224/4, reserved 240/4, broadcast
  )
}

/** Expands an IPv6 address into eight 16-bit groups. Returns null when malformed. */
function parseIPv6(input: string): number[] | null {
  let ip = input
  // Embedded IPv4 in the last 32 bits (e.g. ::ffff:127.0.0.1).
  const lastColon = ip.lastIndexOf(':')
  const tail = ip.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail)
    if (!v4) return null
    const [a = 0, b = 0, c = 0, d = 0] = v4
    ip = `${ip.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'))
  const head = toGroups(halves[0] ?? '')
  const rest = halves.length === 2 ? toGroups(halves[1] ?? '') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  const parsed = groups.map((g) =>
    /^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN,
  )
  return parsed.some(Number.isNaN) ? null : parsed
}

const embeddedIPv4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]

function isPrivateIPv6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g
  const first80Zero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0
  if (first80Zero && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true // :: and ::1
  if (first80Zero && g5 === 0xffff) return isPrivateIPv4(embeddedIPv4(g6, g7)) // ::ffff:a.b.c.d
  if (first80Zero && g5 === 0) return isPrivateIPv4(embeddedIPv4(g6, g7)) // ::a.b.c.d (deprecated)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4(embeddedIPv4(g6, g7)) // NAT64 64:ff9b::/96
  }
  if (g0 === 0x2002) return isPrivateIPv4(embeddedIPv4(g1, g2)) // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true // site-local fec0::/10 (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true // multicast
  return false
}

/**
 * Whether `ip` is not a public unicast address: loopback, unspecified, private,
 * link-local, CGNAT, unique-local, multicast or reserved, including IPv4-mapped,
 * IPv4-compatible, NAT64 and 6to4 IPv6 forms of those. Accepts bracketed IPv6 and
 * zone ids. Returns false for strings that are not IP addresses.
 */
export function isPrivateAddress(input: string): boolean {
  const ip = input
    .trim()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/%.*$/, '')
  const version = isIP(ip)
  if (version === 4) {
    const v4 = parseIPv4(ip)
    return v4 ? isPrivateIPv4(v4) : false
  }
  if (version === 6) {
    const v6 = parseIPv6(ip)
    return v6 ? isPrivateIPv6(v6) : false
  }
  return false
}

// Target checks --------------------------------------------------------------------

export interface WebhookTargetOptions {
  /** Defaults to `WEBHOOK_BLOCK_PRIVATE_NETWORKS`. */
  enabled?: boolean
  /** Defaults to `dns.promises.lookup(host, { all: true })`. */
  resolver?: WebhookResolver
}

/**
 * When the guard is on, checks that `url` is http(s) and that its host is neither
 * `localhost` nor a private address, resolving host names and rejecting the URL
 * if ANY resolved address is private. Returns the vetted addresses (to pin the
 * connection to), or null when the guard is off.
 */
export async function assertAllowedWebhookTarget(
  url: string | URL,
  options: WebhookTargetOptions = {},
): Promise<LookupAddress[] | null> {
  if (!(options.enabled ?? privateNetworksBlocked())) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new WebhookTargetError('scheme', 'Enter a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebhookTargetError('scheme', 'The URL must start with http:// or https://')
  }
  const host = parsed.hostname
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '')
    .toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host)) {
    throw new WebhookTargetError('private', PRIVATE_TARGET_ERROR)
  }
  const family = isIP(host)
  if (family !== 0) return [{ address: host, family }]

  let addresses: LookupAddress[]
  try {
    addresses = await (options.resolver ?? systemResolver)(host)
  } catch {
    throw new WebhookTargetError('unresolvable', `Could not resolve ${host}`)
  }
  if (addresses.length === 0) {
    throw new WebhookTargetError('unresolvable', `Could not resolve ${host}`)
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new WebhookTargetError('private', PRIVATE_TARGET_ERROR)
  }
  return addresses
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

/**
 * A `lookup` for `http.request` / `net.connect` that only ever returns `addresses`,
 * so the connection goes to the addresses that were vetted. TLS still verifies the
 * certificate against the URL's host name.
 */
export function pinnedLookup(addresses: LookupAddress[]) {
  return (_hostname: string, options: unknown, callback: LookupCallback): void => {
    const opts = (typeof options === 'object' && options !== null ? options : {}) as {
      all?: boolean
      family?: number
    }
    const candidates =
      opts.family === 4 || opts.family === 6
        ? addresses.filter((a) => a.family === opts.family)
        : addresses
    if (candidates.length === 0) {
      const error = new Error('No vetted address for this address family') as NodeJS.ErrnoException
      error.code = 'ENOTFOUND'
      callback(error, opts.all ? [] : '', undefined)
      return
    }
    if (opts.all) callback(null, candidates)
    else callback(null, candidates[0]?.address ?? '', candidates[0]?.family)
  }
}
