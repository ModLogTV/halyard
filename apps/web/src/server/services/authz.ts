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

/** `userId` of actors created by {@link systemActor}. */
export const SYSTEM_USER_ID = 'system'

/**
 * An actor for background work done by Halyard itself (for example the scheduler
 * applying a scheduled change). It holds the `owner` role so the services it calls
 * accept it; audit rows written for it name it as `{ type: 'system', name }`.
 * Never derive one from request input.
 */
export function systemActor(projectId: string, name: string): ProjectActor {
  return {
    userId: SYSTEM_USER_ID,
    name,
    email: 'system@halyard.invalid',
    isAdmin: false,
    projectId,
    role: 'owner',
  }
}

/** Prefix of `userId` for actors derived from a management API key. */
export const API_KEY_USER_PREFIX = 'apikey:'

/**
 * The user id to store in `created_by` / `updated_by` columns, which reference the
 * user table. System and API key actors are not users, so they are stored as null;
 * the audit log still names them.
 */
export function persistedUserId(actor: Pick<Actor, 'userId'>): string | null {
  if (actor.userId === SYSTEM_USER_ID || actor.userId.startsWith(API_KEY_USER_PREFIX)) return null
  return actor.userId
}

export function auditActor(actor: Actor): AuditActor {
  if (actor.userId === SYSTEM_USER_ID) return { type: 'system', name: actor.name }
  if (actor.userId.startsWith(API_KEY_USER_PREFIX)) {
    return { type: 'api_key', id: actor.userId.slice(API_KEY_USER_PREFIX.length), name: actor.name }
  }
  return { type: 'user', id: actor.userId, name: actor.name }
}
