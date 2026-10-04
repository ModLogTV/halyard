import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { invitation, member, organization, user } from '@/db/schema'
import { auth } from '@/lib/auth'
import type { ProjectRole } from '@/lib/permissions'
import { badRequest, notFound } from '@/server/errors'
import {
  cancelInvitationSchema,
  type InviteMemberInput,
  invitationRefSchema,
  inviteMemberSchema,
  leaveProjectSchema,
  listMembersSchema,
  removeMemberSchema,
  type UpdateMemberRoleInput,
  updateMemberRoleSchema,
} from '../schemas/members'
import { recordAudit } from './audit'
import {
  assertProjectAccess,
  auditActor,
  type ProjectActorWithHeaders,
  type UserActorWithHeaders,
} from './authz'
import { authCall, parseInput } from './util'

export interface MemberItem {
  id: string
  userId: string
  name: string
  email: string
  image: string | null
  role: ProjectRole
  createdAt: Date
}

export interface PendingInvitation {
  id: string
  email: string
  role: ProjectRole
  expiresAt: Date
  createdAt: Date
  inviterId: string
}

export interface MyInvitation {
  id: string
  projectId: string
  projectName: string
  /** Same as `projectName`; the name better-auth uses for the organization. */
  organizationName: string
  projectSlug: string
  role: ProjectRole
  expiresAt: Date
  inviterName: string | null
}

const asRole = (role: string | null): ProjectRole => (role ?? 'viewer') as ProjectRole

/** Members and still-open invitations of a project. Any member can see them. */
export async function listMembers(
  actor: ProjectActorWithHeaders,
  input: { projectId: string },
): Promise<{ members: MemberItem[]; invitations: PendingInvitation[] }> {
  const { projectId } = parseInput(listMembersSchema, input)
  assertProjectAccess(actor, projectId, { project: ['read'] })

  const members = await db
    .select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, projectId))
    .orderBy(asc(member.createdAt))

  const invitations = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, projectId),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitation.createdAt))

  return {
    members: members.map((m) => ({ ...m, role: asRole(m.role) })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: asRole(i.role),
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      inviterId: i.inviterId,
    })),
  }
}

export async function inviteMember(
  actor: ProjectActorWithHeaders,
  input: InviteMemberInput,
): Promise<PendingInvitation> {
  const data = parseInput(inviteMemberSchema, input)
  assertProjectAccess(actor, data.projectId, { invitation: ['create'] })

  const created = await authCall(() =>
    auth.api.createInvitation({
      headers: actor.headers,
      body: { organizationId: data.projectId, email: data.email, role: data.role },
    }),
  )

  await recordAudit(db, {
    projectId: data.projectId,
    actor: auditActor(actor),
    action: 'member.invited',
    entityType: 'member',
    entityId: created.id,
    entityKey: data.email,
    after: { email: data.email, role: data.role },
  })

  return {
    id: created.id,
    email: created.email,
    role: asRole(created.role),
    expiresAt: created.expiresAt,
    createdAt: created.createdAt,
    inviterId: created.inviterId,
  }
}

export async function cancelInvitation(
  actor: ProjectActorWithHeaders,
  input: { projectId: string; invitationId: string },
): Promise<{ id: string }> {
  const { projectId, invitationId } = parseInput(cancelInvitationSchema, input)
  assertProjectAccess(actor, projectId, { invitation: ['cancel'] })

  const [existing] = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, projectId)))
  if (existing?.status !== 'pending') throw notFound('Invitation')

  await authCall(() =>
    auth.api.cancelInvitation({ headers: actor.headers, body: { invitationId } }),
  )
  await recordAudit(db, {
    projectId,
    actor: auditActor(actor),
    action: 'member.invitation_canceled',
    entityType: 'member',
    entityId: invitationId,
    entityKey: existing.email,
    before: { email: existing.email, role: existing.role },
  })
  return { id: invitationId }
}

/**
 * Pending invitations addressed to the signed-in user. The plugin refuses to list
 * invitations for unverified email addresses when called with request headers;
 * Halyard does not send verification emails, so the lookup is done server-side by
 * the (session-verified) email of the actor.
 */
export async function listMyInvitations(actor: UserActorWithHeaders): Promise<MyInvitation[]> {
  const invitations = await authCall(() =>
    auth.api.listUserInvitations({ query: { email: actor.email } }),
  )
  const live = invitations.filter((i) => new Date(i.expiresAt) > new Date())
  if (live.length === 0) return []

  const inviters = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...new Set(live.map((i) => i.inviterId))]))
  const inviterName = new Map(inviters.map((u) => [u.id, u.name]))
  const orgs = await db
    .select()
    .from(organization)
    .where(inArray(organization.id, [...new Set(live.map((i) => i.organizationId))]))
  const orgById = new Map(orgs.map((o) => [o.id, o]))

  return live.flatMap((i) => {
    const org = orgById.get(i.organizationId)
    if (!org) return []
    return [
      {
        id: i.id,
        projectId: org.id,
        organizationName: org.name,
        projectName: org.name,
        projectSlug: org.slug,
        role: asRole(i.role),
        expiresAt: new Date(i.expiresAt),
        inviterName: inviterName.get(i.inviterId) ?? null,
      },
    ]
  })
}

export async function acceptInvitation(
  actor: UserActorWithHeaders,
  input: { invitationId: string },
): Promise<{ projectId: string; role: ProjectRole }> {
  const { invitationId } = parseInput(invitationRefSchema, input)
  const accepted = await authCall(() =>
    auth.api.acceptInvitation({ headers: actor.headers, body: { invitationId } }),
  )
  if (!accepted) throw notFound('Invitation')
  const projectId = accepted.invitation.organizationId
  await recordAudit(db, {
    projectId,
    actor: auditActor(actor),
    action: 'member.joined',
    entityType: 'member',
    entityId: accepted.member.id,
    entityKey: actor.email,
    after: { email: actor.email, role: accepted.member.role },
  })
  return { projectId, role: asRole(accepted.member.role) }
}

export async function rejectInvitation(
  actor: UserActorWithHeaders,
  input: { invitationId: string },
): Promise<{ id: string }> {
  const { invitationId } = parseInput(invitationRefSchema, input)
  await authCall(() =>
    auth.api.rejectInvitation({ headers: actor.headers, body: { invitationId } }),
  )
  return { id: invitationId }
}

async function findMember(projectId: string, memberId: string) {
  const [row] = await db
    .select({ id: member.id, userId: member.userId, role: member.role, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.id, memberId), eq(member.organizationId, projectId)))
  if (!row) throw notFound('Member')
  return row
}

async function ownerCount(projectId: string): Promise<number> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, projectId))
  return rows.filter((r) => r.role.split(',').includes('owner')).length
}

export async function updateMemberRole(
  actor: ProjectActorWithHeaders,
  input: UpdateMemberRoleInput,
): Promise<{ id: string; role: ProjectRole }> {
  const { projectId, memberId, role } = parseInput(updateMemberRoleSchema, input)
  assertProjectAccess(actor, projectId, { member: ['update'] })

  const target = await findMember(projectId, memberId)
  if (target.role === role) return { id: memberId, role }
  if (
    target.role.split(',').includes('owner') &&
    role !== 'owner' &&
    (await ownerCount(projectId)) <= 1
  ) {
    throw badRequest('A project needs at least one owner')
  }

  await authCall(() =>
    auth.api.updateMemberRole({
      headers: actor.headers,
      body: { memberId, role, organizationId: projectId },
    }),
  )
  await recordAudit(db, {
    projectId,
    actor: auditActor(actor),
    action: 'member.role_changed',
    entityType: 'member',
    entityId: memberId,
    entityKey: target.email,
    before: { role: target.role },
    after: { role },
  })
  return { id: memberId, role }
}

export async function removeMember(
  actor: ProjectActorWithHeaders,
  input: { projectId: string; memberId: string },
): Promise<{ id: string }> {
  const { projectId, memberId } = parseInput(removeMemberSchema, input)
  assertProjectAccess(actor, projectId, { member: ['delete'] })

  const target = await findMember(projectId, memberId)
  if (target.role.split(',').includes('owner') && (await ownerCount(projectId)) <= 1) {
    throw badRequest('A project needs at least one owner')
  }

  await authCall(() =>
    auth.api.removeMember({
      headers: actor.headers,
      body: { memberIdOrEmail: memberId, organizationId: projectId },
    }),
  )
  await recordAudit(db, {
    projectId,
    actor: auditActor(actor),
    action: 'member.removed',
    entityType: 'member',
    entityId: memberId,
    entityKey: target.email,
    before: { role: target.role },
  })
  return { id: memberId }
}

/** Any member may leave; the last owner may not. */
export async function leaveProject(
  actor: ProjectActorWithHeaders,
  input: { projectId: string },
): Promise<{ projectId: string }> {
  const { projectId } = parseInput(leaveProjectSchema, input)
  assertProjectAccess(actor, projectId, {})

  const [self] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, projectId), eq(member.userId, actor.userId)))
  if (!self) throw notFound('Member')
  if (self.role.split(',').includes('owner') && (await ownerCount(projectId)) <= 1) {
    throw badRequest('You are the only owner. Promote another member or delete the project instead')
  }

  await authCall(() =>
    auth.api.leaveOrganization({ headers: actor.headers, body: { organizationId: projectId } }),
  )
  await recordAudit(db, {
    projectId,
    actor: auditActor(actor),
    action: 'member.left',
    entityType: 'member',
    entityId: self.id,
    entityKey: actor.email,
    before: { role: self.role },
  })
  return { projectId }
}
