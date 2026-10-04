/**
 * Access control for Halyard.
 *
 * A Halyard project is a better-auth organization. Project roles are therefore
 * organization roles, enforced server-side through `auth.api.hasPermission` and
 * mirrored on the client for showing or hiding controls.
 */
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'

export const statement = {
  ...defaultStatements,
  project: ['read', 'update', 'delete'],
  environment: ['read', 'create', 'update', 'delete'],
  flag: ['read', 'create', 'update', 'delete', 'toggle', 'promote'],
  segment: ['read', 'create', 'update', 'delete'],
  experiment: ['read', 'create', 'update', 'delete'],
  schedule: ['read', 'create', 'update', 'delete'],
  webhook: ['read', 'create', 'update', 'delete'],
  apiKey: ['read', 'create', 'delete'],
  audit: ['read'],
  playground: ['use'],
  transfer: ['export', 'import'],
} as const

export const ac = createAccessControl(statement)

const viewerPermissions = {
  project: ['read'],
  environment: ['read'],
  flag: ['read'],
  segment: ['read'],
  experiment: ['read'],
  schedule: ['read'],
  webhook: ['read'],
  apiKey: ['read'],
  audit: ['read'],
  playground: ['use'],
  transfer: ['export'],
} as const

const editorPermissions = {
  ...viewerPermissions,
  flag: ['read', 'create', 'update', 'delete', 'toggle', 'promote'],
  segment: ['read', 'create', 'update', 'delete'],
  experiment: ['read', 'create', 'update', 'delete'],
  schedule: ['read', 'create', 'update', 'delete'],
  transfer: ['export', 'import'],
} as const

export const viewer = ac.newRole(viewerPermissions)
export const editor = ac.newRole(editorPermissions)
export const owner = ac.newRole({
  ...editorPermissions,
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  project: ['read', 'update', 'delete'],
  environment: ['read', 'create', 'update', 'delete'],
  webhook: ['read', 'create', 'update', 'delete'],
  apiKey: ['read', 'create', 'delete'],
})

export const roles = { owner, editor, viewer } as const
export type ProjectRole = keyof typeof roles
export const PROJECT_ROLES = ['owner', 'editor', 'viewer'] as const satisfies readonly ProjectRole[]

export type Permissions = { [K in keyof typeof statement]?: (typeof statement)[K][number][] }
