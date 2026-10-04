/**
 * Response headers every Halyard response carries, so self-hosted instances
 * are safe even when the reverse proxy adds nothing. Headers the app set
 * itself are never overridden.
 */

export interface SecurityHeaderOptions {
  /** Whether the public URL is served over https (enables HSTS). */
  https: boolean
}

export function securityHeaders({ https }: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    // Inline scripts and styles from the SSR framework make a stricter CSP impractical today;
    // the frame-ancestors directive is the part that does not depend on them.
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  }
  if (https) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  return headers
}

/** Returns a response with the security headers added (existing headers win). */
export function applySecurityHeaders(response: Response, options: SecurityHeaderOptions): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(securityHeaders(options))) {
    if (!headers.has(name)) headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
