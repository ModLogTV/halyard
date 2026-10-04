import { createFileRoute } from '@tanstack/react-router'
import { handleMcpRequest } from '@/server/mcp/handler'

/** Model Context Protocol endpoint for AI agents, authenticated with a management key. */
export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
})
