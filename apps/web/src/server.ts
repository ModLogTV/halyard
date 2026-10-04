import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { bootstrap } from '@/server/bootstrap'

/**
 * Server entry used by both `vite dev` and the production build. Bootstrapping is
 * idempotent, so the first request on each process starts migrations and workers.
 */
export default createServerEntry({
  async fetch(request) {
    await bootstrap()
    return handler.fetch(request)
  },
})
