import { createFileRoute } from '@tanstack/react-router'
import { handleSingleEvaluation, ofrepPreflight } from '@/server/ofrep/handler'

/** OFREP single flag evaluation. */
export const Route = createFileRoute('/ofrep/v1/evaluate/flags/$key')({
  server: {
    handlers: {
      POST: ({ request, params }) => handleSingleEvaluation(request, params.key),
      OPTIONS: () => ofrepPreflight(),
    },
  },
})
