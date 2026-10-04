/**
 * Client IP handling for rate limiting. Forwarding headers are only trusted
 * when the operator lists the proxies that set them (TRUSTED_PROXIES);
 * otherwise anybody who can reach the app directly could pick their own
 * address and bypass the limits.
 */

export function parseTrustedProxies(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export interface IpAddressOptions {
  ipAddressHeaders: string[]
  trustedProxies?: string[]
}

/** better-auth `advanced.ipAddress` options for the given trusted proxy list. */
export function ipAddressOptions(trustedProxies: string[]): IpAddressOptions {
  if (trustedProxies.length === 0) return { ipAddressHeaders: [] }
  return { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'], trustedProxies }
}
