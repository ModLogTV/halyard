import { describe, expect, it } from 'vitest'
import { applySecurityHeaders, securityHeaders } from '@/server/http/security-headers'

describe('securityHeaders', () => {
  it('sets the baseline headers', () => {
    const headers = securityHeaders({ https: false })
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'none'")
    expect(headers['Permissions-Policy']).toContain('camera=()')
  })

  it('adds HSTS only for https deployments', () => {
    expect(securityHeaders({ https: false })['Strict-Transport-Security']).toBeUndefined()
    expect(securityHeaders({ https: true })['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains',
    )
  })
})

describe('applySecurityHeaders', () => {
  it('adds headers while keeping status, body and existing headers', async () => {
    const response = new Response('hello', {
      status: 201,
      headers: { 'Content-Type': 'text/plain', 'X-Custom': '1' },
    })
    const result = applySecurityHeaders(response, { https: true })
    expect(result.status).toBe(201)
    expect(await result.text()).toBe('hello')
    expect(result.headers.get('Content-Type')).toBe('text/plain')
    expect(result.headers.get('X-Custom')).toBe('1')
    expect(result.headers.get('X-Frame-Options')).toBe('DENY')
    expect(result.headers.get('Strict-Transport-Security')).toContain('max-age=')
  })

  it('does not override a header the app already set', () => {
    const response = new Response(null, {
      headers: { 'Content-Security-Policy': "default-src 'self'" },
    })
    const result = applySecurityHeaders(response, { https: false })
    expect(result.headers.get('Content-Security-Policy')).toBe("default-src 'self'")
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('works on responses with immutable headers such as redirects', () => {
    const result = applySecurityHeaders(Response.redirect('http://localhost/login', 307), {
      https: false,
    })
    expect(result.status).toBe(307)
    expect(result.headers.get('Location')).toBe('http://localhost/login')
    expect(result.headers.get('X-Frame-Options')).toBe('DENY')
  })
})
