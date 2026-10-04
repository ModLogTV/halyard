import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { env } from '@/lib/env'
import { bootstrap } from '@/server/bootstrap'
import { applySecurityHeaders } from '@/server/http/security-headers'

/**
 * Server entry used by both `vite dev` and the production build. Bootstrapping is
 * idempotent, so the first request on each process starts migrations and workers.
 */
export default createServerEntry({
  async fetch(request) {
    await bootstrap()
    const response = await handler.fetch(request)
    return applySecurityHeaders(response, { https: env().BETTER_AUTH_URL.startsWith('https://') })
  },
})
