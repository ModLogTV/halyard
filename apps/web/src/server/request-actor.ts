import { getRequestHeaders } from '@tanstack/react-start/server'
import type { Permissions } from '@/lib/permissions'
import { requireProjectPermission, requireUser } from '@/server/auth/session'
import type { ProjectActorWithHeaders, UserActorWithHeaders } from '@/server/services/authz'

/**
 * Resolves the actor for the current request. These are the only places where server
 * functions turn an HTTP request into the explicit actor that services operate on.
 */
export async function userActor(): Promise<UserActorWithHeaders> {
  const actor = await requireUser()
  return { ...actor, headers: getRequestHeaders() }
}

/** Requires project membership and `permissions`; returns the actor with its role. */
export async function projectActor(
  projectId: string,
  permissions?: Permissions,
): Promise<ProjectActorWithHeaders> {
  const actor = await requireProjectPermission(projectId, permissions)
  return { ...actor, headers: getRequestHeaders() }
}
