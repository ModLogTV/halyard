import { authenticateManagementKey, type ManagementPrincipal } from '@/server/auth/api-key'
import type { ProjectActor } from '@/server/auth/session'
import { errorResponse } from '@/server/errors'

/** Permissions a management key must hold. */
export const READ_KEY: Record<string, string[]> = { project: ['read'] }
export const WRITE_KEY: Record<string, string[]> = { project: ['write'] }

/** Prefix of `ProjectActor.userId` for actors that are management keys. */
export const API_KEY_ACTOR_PREFIX = 'apikey:'

/**
 * The actor a management key acts as. Keys that can write act as `editor` (they cannot
 * change members or keys), read-only keys as `viewer`. The actor has no user row:
 * `userId` is `apikey:<keyId>` and `name` the key's name, so audit rows can attribute
 * changes to the key (see `importAuditActor`).
 */
export function apiKeyActor(principal: ManagementPrincipal): ProjectActor {
  return {
    userId: `${API_KEY_ACTOR_PREFIX}${principal.keyId}`,
    name: principal.keyName,
    email: '',
    isAdmin: false,
    projectId: principal.projectId,
    role: principal.permissions.project?.includes('write') ? 'editor' : 'viewer',
  }
}

export interface ManagementContext {
  request: Request
  principal: ManagementPrincipal
  actor: ProjectActor
}

type RouteArgs = { request: Request }

/**
 * Wraps a management API handler: authenticates `Authorization: Bearer hal_mgmt_...`,
 * checks the key's permissions and turns thrown errors into `{ error, message }` JSON
 * responses (401 without a valid key, 403 without the required permission).
 */
export function withManagementKey(
  handler: (context: ManagementContext) => Response | Promise<Response>,
  required: Record<string, string[]> = READ_KEY,
): (args: RouteArgs) => Promise<Response> {
  return async ({ request }) => {
    try {
      const principal = await authenticateManagementKey(request, required)
      return await handler({ request, principal, actor: apiKeyActor(principal) })
    } catch (error) {
      return errorResponse(error)
    }
  }
}
