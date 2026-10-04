import { createFileRoute } from '@tanstack/react-router'
import { handleRuleset } from '@/server/ofrep/handler'

/** Full ruleset of the SDK key's environment, for local evaluation with @modlogtv/halyard-engine. */
export const Route = createFileRoute('/api/v1/ruleset')({
  server: {
    handlers: {
      GET: ({ request }) => handleRuleset(request),
    },
  },
})
