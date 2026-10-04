import { createMcpHandler, originValidationResponse } from '@modelcontextprotocol/server'
import { env } from '@/lib/env'
import { READ_KEY } from '@/server/api/auth'
import { authenticateManagementKey, type ManagementPrincipal } from '@/server/auth/api-key'
import { errorResponse, unauthorized } from '@/server/errors'
import { createHalyardMcpServer } from './server'

/**
 * Serves MCP over streamable HTTP. Every request is answered by a fresh server
 * instance (stateless), so it works the same behind any number of replicas.
 */
const handler = createMcpHandler(({ authInfo }) => {
  const principal = authInfo?.extra?.principal as ManagementPrincipal | undefined
  if (!principal) throw unauthorized()
  return createHalyardMcpServer(principal)
})

/**
 * Authenticates the management key (`Authorization: Bearer hal_mgmt_...`) and hands
 * the request to the MCP handler. Browser requests from other origins are refused
 * (DNS rebinding protection required by the MCP specification).
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const rejected = originValidationResponse(request, [new URL(env().BETTER_AUTH_URL).hostname])
  if (rejected) return rejected
  try {
    const principal = await authenticateManagementKey(request, READ_KEY)
    return await handler.fetch(request, {
      authInfo: {
        token: principal.keyId,
        clientId: principal.keyId,
        scopes: (principal.permissions.project ?? []).map((action) => `project:${action}`),
        extra: { principal },
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
