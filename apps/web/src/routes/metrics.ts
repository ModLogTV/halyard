import { createFileRoute } from '@tanstack/react-router'
import { env } from '@/lib/env'
import { registry } from '@/server/evaluation/metrics'

/**
 * Prometheus metrics. When METRICS_TOKEN is configured the endpoint requires
 * `Authorization: Bearer <token>`; otherwise it is open, which suits cluster
 * internal scraping.
 */
export const Route = createFileRoute('/metrics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = env().METRICS_TOKEN
        if (token) {
          const header = request.headers.get('authorization') ?? ''
          if (header !== `Bearer ${token}`) {
            return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
          }
        }
        const body = await registry.metrics()
        return new Response(body, { headers: { 'Content-Type': registry.contentType } })
      },
    },
  },
})
