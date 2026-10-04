import { createFileRoute } from '@tanstack/react-router'
import { handleBulkEvaluation, ofrepPreflight } from '@/server/ofrep/handler'

/** OFREP bulk evaluation. Server handlers only run for the leaf route, so `flags/$key` is unaffected. */
export const Route = createFileRoute('/ofrep/v1/evaluate/flags')({
  server: {
    handlers: {
      POST: ({ request }) => handleBulkEvaluation(request),
      OPTIONS: () => ofrepPreflight(),
    },
  },
})
