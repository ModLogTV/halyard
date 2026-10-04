import { type Permissions, roles } from '@/lib/permissions'
import type { Actor, ProjectActor } from '@/server/auth/session'
import { forbidden } from '@/server/errors'
import type { AuditActor } from './audit'

export type { Actor, ProjectActor }

/** Services that call better-auth endpoints need the caller's session headers. */
export type WithHeaders<T> = T & { headers: Headers }
export type UserActorWithHeaders = WithHeaders<Actor>
export type ProjectActorWithHeaders = WithHeaders<ProjectActor>

/**
 * Checks the actor's project role against the static role definitions in
 * `src/lib/permissions.ts`. This is synchronous and does not touch the database,
 * so services can afford to call it on every operation. Server functions have
 * already verified membership and permissions through `requireProjectPermission`;
 * this is the second, service-level line of defence.
 */
export function assertPermission(
  actor: Pick<ProjectActor, 'role'>,
  permissions: Permissions,
): void {
  const role = roles[actor.role]
  if (!role) throw forbidden()
  // Nothing requested: membership alone is enough.
  if (Object.keys(permissions).length === 0) return
  const result = role.authorize(permissions as Record<string, string[]>)
  if (!result.success) throw forbidden()
}

/** Ensures the actor was authorized for `projectId` and holds `permissions` in it. */
export function assertProjectAccess(
  actor: ProjectActor,
  projectId: string,
  permissions: Permissions,
): void {
  if (actor.projectId !== projectId) throw forbidden('You are not a member of this project')
  assertPermission(actor, permissions)
}

export function auditActor(actor: Actor): AuditActor {
  return { type: 'user', id: actor.userId, name: actor.name }
}
