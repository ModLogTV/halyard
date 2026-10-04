import { createFileRoute } from '@tanstack/react-router'
import { handleConfiguration, ofrepPreflight } from '@/server/ofrep/handler'

/** Legacy OFREP provider configuration (removed from the protocol in 2025, kept for older providers). */
export const Route = createFileRoute('/ofrep/v1/configuration')({
  server: {
    handlers: {
      GET: ({ request }) => handleConfiguration(request),
      OPTIONS: () => ofrepPreflight('GET, OPTIONS'),
    },
  },
})
