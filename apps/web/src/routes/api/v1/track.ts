import { createFileRoute } from '@tanstack/react-router'
import { handleTrack, trackPreflight } from '@/server/experiments/track-handler'

/** Conversion events for experiments, authenticated with an SDK key. */
export const Route = createFileRoute('/api/v1/track')({
  server: {
    handlers: {
      POST: ({ request }) => handleTrack(request),
      OPTIONS: () => trackPreflight(),
    },
  },
})
