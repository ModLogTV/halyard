import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { member } from '@/db/schema'
import { auth } from '@/lib/auth'
import type { Permissions, ProjectRole } from '@/lib/permissions'
import { forbidden, unauthorized } from '@/server/errors'

export interface Actor {
  userId: string
  name: string
  email: string
  /** Instance-wide admin from the admin plugin. */
  isAdmin: boolean
}

/** Returns the signed-in user for the current request or throws 401. */
export async function requireUser(): Promise<Actor> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw unauthorized()
  const role = session.user.role ?? 'user'
  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    isAdmin: role.split(',').includes('admin'),
  }
}

/** The role a user has in a project, or null when they are not a member. */
export async function getProjectRole(
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  const row = await db.query.member.findFirst({
    where: and(eq(member.userId, userId), eq(member.organizationId, projectId)),
    columns: { role: true },
  })
  if (!row) return null
  return row.role as ProjectRole
}

export interface ProjectActor extends Actor {
  projectId: string
  role: ProjectRole
}

/**
 * Ensures the signed-in user is a member of the project and holds the given
 * permissions. Permission checks are delegated to the organization plugin so the
 * role definitions in `permissions.ts` are the single source of truth.
 */
export async function requireProjectPermission(
  projectId: string,
  permissions?: Permissions,
): Promise<ProjectActor> {
  const actor = await requireUser()
  const role = await getProjectRole(actor.userId, projectId)
  if (!role) throw forbidden('You are not a member of this project')
  if (permissions && Object.keys(permissions).length > 0) {
    const result = await auth.api.hasPermission({
      headers: getRequestHeaders(),
      body: { organizationId: projectId, permissions: permissions as Record<string, string[]> },
    })
    if (!result.success) throw forbidden()
  }
  return { ...actor, projectId, role }
}
