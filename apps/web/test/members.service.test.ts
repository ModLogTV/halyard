import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, invitation, member } from '@/db/schema'
import {
  acceptInvitation,
  cancelInvitation,
  inviteMember,
  leaveProject,
  listMembers,
  listMyInvitations,
  rejectInvitation,
  removeMember,
  updateMemberRole,
} from '@/server/services/members'
import { listProjectsForUser } from '@/server/services/projects'
import { createProjectFixture, type ProjectFixture, userActorFor } from './factories'
import { createTestUser, resetDatabase } from './helpers'

let fx: ProjectFixture

beforeEach(async () => {
  await resetDatabase()
  fx = await createProjectFixture()
})

const memberIdOf = async (userId: string) => {
  const [row] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, fx.projectId), eq(member.userId, userId)))
  if (!row) throw new Error('not a member')
  return row.id
}

const roleOf = async (userId: string) => {
  const [row] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, fx.projectId), eq(member.userId, userId)))
  return row?.role ?? null
}

const auditEntries = (action: string) =>
  db.select().from(auditLog).where(eq(auditLog.action, action))

describe('listMembers', () => {
  it('returns members with user details and open invitations for any member', async () => {
    await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'new@example.com',
      role: 'editor',
    })
    const expired = await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'late@example.com',
      role: 'viewer',
    })
    await db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.id, expired.id))

    const result = await listMembers(fx.viewer.actor, { projectId: fx.projectId })
    expect(result.members.map((m) => [m.name, m.role])).toEqual([
      ['Olivia Owner', 'owner'],
      ['Eddie Editor', 'editor'],
      ['Vera Viewer', 'viewer'],
    ])
    expect(result.members[0]).toMatchObject({
      email: expect.stringContaining('@example.com'),
      userId: fx.owner.user.id,
    })
    expect(result.invitations).toEqual([
      expect.objectContaining({
        email: 'new@example.com',
        role: 'editor',
        inviterId: fx.owner.user.id,
      }),
    ])
  })

  it('refuses outsiders', async () => {
    const other = await createProjectFixture('other')
    await expect(listMembers(other.owner.actor, { projectId: fx.projectId })).rejects.toMatchObject(
      { status: 403 },
    )
  })
})

describe('inviteMember', () => {
  it('creates an invitation and audits it', async () => {
    const invited = await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'Someone@Example.com',
      role: 'viewer',
    })
    expect(invited).toMatchObject({
      email: 'someone@example.com',
      role: 'viewer',
      inviterId: fx.owner.user.id,
    })
    const [entry] = await auditEntries('member.invited')
    expect(entry).toMatchObject({
      entityType: 'member',
      entityId: invited.id,
      entityKey: 'someone@example.com',
      actorName: 'Olivia Owner',
    })
    expect(entry?.after).toEqual({ email: 'someone@example.com', role: 'viewer' })
  })

  it('rejects bad input, existing members and duplicate invitations with 400', async () => {
    await expect(
      inviteMember(fx.owner.actor, {
        projectId: fx.projectId,
        email: 'not-an-email',
        role: 'viewer',
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      inviteMember(fx.owner.actor, {
        projectId: fx.projectId,
        email: 'x@example.com',
        role: 'admin' as never,
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      inviteMember(fx.owner.actor, {
        projectId: fx.projectId,
        email: fx.editor.user.email,
        role: 'viewer',
      }),
    ).rejects.toMatchObject({ status: 400 })
    await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'dup@example.com',
      role: 'viewer',
    })
    await expect(
      inviteMember(fx.owner.actor, {
        projectId: fx.projectId,
        email: 'dup@example.com',
        role: 'viewer',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('is owner only', async () => {
    for (const who of [fx.editor, fx.viewer]) {
      await expect(
        inviteMember(who.actor, {
          projectId: fx.projectId,
          email: 'x@example.com',
          role: 'viewer',
        }),
      ).rejects.toMatchObject({ status: 403 })
    }
    expect(await db.select().from(invitation)).toHaveLength(0)
  })
})

describe('invitation lifecycle', () => {
  it('lets the invitee see, accept and use an invitation', async () => {
    const invitee = await createTestUser({ name: 'Ivy Invitee', email: 'ivy@example.com' })
    const actor = userActorFor(invitee, 'Ivy Invitee')
    const invited = await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'ivy@example.com',
      role: 'editor',
    })

    const mine = await listMyInvitations(actor)
    expect(mine).toEqual([
      expect.objectContaining({
        id: invited.id,
        projectId: fx.projectId,
        projectName: 'Acme',
        organizationName: 'Acme',
        projectSlug: 'acme',
        role: 'editor',
        inviterName: 'Olivia Owner',
      }),
    ])

    expect(await acceptInvitation(actor, { invitationId: invited.id })).toEqual({
      projectId: fx.projectId,
      role: 'editor',
    })
    expect(await roleOf(invitee.id)).toBe('editor')
    expect(await listMyInvitations(actor)).toEqual([])
    expect((await listProjectsForUser(invitee.id)).map((p) => [p.slug, p.role])).toEqual([
      ['acme', 'editor'],
    ])

    const [entry] = await auditEntries('member.joined')
    expect(entry).toMatchObject({
      projectId: fx.projectId,
      actorId: invitee.id,
      entityKey: 'ivy@example.com',
    })
    expect(entry?.after).toEqual({ email: 'ivy@example.com', role: 'editor' })
  })

  it('lets the invitee reject an invitation', async () => {
    const invitee = await createTestUser({ email: 'rej@example.com' })
    const actor = userActorFor(invitee, 'R')
    const invited = await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'rej@example.com',
      role: 'viewer',
    })
    await rejectInvitation(actor, { invitationId: invited.id })
    expect(await roleOf(invitee.id)).toBeNull()
    expect(await listMyInvitations(actor)).toEqual([])
    await expect(acceptInvitation(actor, { invitationId: invited.id })).rejects.toMatchObject({
      status: 400,
    })
  })

  it("does not let anyone act on someone else's invitation", async () => {
    const invited = await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'target@example.com',
      role: 'owner',
    })
    const mallory = userActorFor(fx.outsider, 'Otto Outsider')
    await expect(acceptInvitation(mallory, { invitationId: invited.id })).rejects.toMatchObject({
      status: 403,
    })
    await expect(rejectInvitation(mallory, { invitationId: invited.id })).rejects.toMatchObject({
      status: 403,
    })
    expect(await listMyInvitations(mallory)).toEqual([])
    expect(await roleOf(fx.outsider.id)).toBeNull()
  })

  it('hides and refuses expired invitations', async () => {
    const invitee = await createTestUser({ email: 'old@example.com' })
    const actor = userActorFor(invitee, 'Old')
    const invited = await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'old@example.com',
      role: 'viewer',
    })
    await db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.id, invited.id))
    expect(await listMyInvitations(actor)).toEqual([])
    await expect(acceptInvitation(actor, { invitationId: invited.id })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('lets owners cancel a pending invitation, and nobody else', async () => {
    const invitee = await createTestUser({ email: 'cancel@example.com' })
    const invited = await inviteMember(fx.owner.actor, {
      projectId: fx.projectId,
      email: 'cancel@example.com',
      role: 'viewer',
    })
    await expect(
      cancelInvitation(fx.editor.actor, { projectId: fx.projectId, invitationId: invited.id }),
    ).rejects.toMatchObject({ status: 403 })
    await cancelInvitation(fx.owner.actor, { projectId: fx.projectId, invitationId: invited.id })
    expect(await listMyInvitations(userActorFor(invitee, 'C'))).toEqual([])
    expect(await auditEntries('member.invitation_canceled')).toHaveLength(1)
    await expect(
      cancelInvitation(fx.owner.actor, { projectId: fx.projectId, invitationId: invited.id }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('updateMemberRole', () => {
  it('lets owners change roles and audits before and after', async () => {
    const memberId = await memberIdOf(fx.viewer.user.id)
    const result = await updateMemberRole(fx.owner.actor, {
      projectId: fx.projectId,
      memberId,
      role: 'editor',
    })
    expect(result).toEqual({ id: memberId, role: 'editor' })
    expect(await roleOf(fx.viewer.user.id)).toBe('editor')
    const [entry] = await auditEntries('member.role_changed')
    expect(entry).toMatchObject({
      entityId: memberId,
      entityKey: fx.viewer.user.email,
      actorId: fx.owner.user.id,
    })
    expect(entry?.before).toEqual({ role: 'viewer' })
    expect(entry?.after).toEqual({ role: 'editor' })
  })

  it('does not let editors or viewers change roles, not even their own', async () => {
    const viewerId = await memberIdOf(fx.viewer.user.id)
    const editorId = await memberIdOf(fx.editor.user.id)
    await expect(
      updateMemberRole(fx.editor.actor, {
        projectId: fx.projectId,
        memberId: viewerId,
        role: 'editor',
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      updateMemberRole(fx.editor.actor, {
        projectId: fx.projectId,
        memberId: editorId,
        role: 'owner',
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      updateMemberRole(fx.viewer.actor, {
        projectId: fx.projectId,
        memberId: viewerId,
        role: 'owner',
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await roleOf(fx.editor.user.id)).toBe('editor')
    expect(await roleOf(fx.viewer.user.id)).toBe('viewer')
  })

  it('blocks removing the last owner and allows it once another owner exists', async () => {
    const ownerId = await memberIdOf(fx.owner.user.id)
    await expect(
      updateMemberRole(fx.owner.actor, {
        projectId: fx.projectId,
        memberId: ownerId,
        role: 'editor',
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(await roleOf(fx.owner.user.id)).toBe('owner')

    await updateMemberRole(fx.owner.actor, {
      projectId: fx.projectId,
      memberId: await memberIdOf(fx.editor.user.id),
      role: 'owner',
    })
    await expect(
      updateMemberRole(fx.owner.actor, {
        projectId: fx.projectId,
        memberId: ownerId,
        role: 'editor',
      }),
    ).resolves.toMatchObject({ role: 'editor' })
  })

  it('404s for members of other projects and rejects invalid roles', async () => {
    const other = await createProjectFixture('other')
    await expect(
      updateMemberRole(fx.owner.actor, {
        projectId: fx.projectId,
        memberId: 'nope',
        role: 'editor',
      }),
    ).rejects.toMatchObject({ status: 404 })
    const [theirs] = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, other.projectId))
    await expect(
      updateMemberRole(fx.owner.actor, {
        projectId: fx.projectId,
        memberId: theirs?.id ?? '',
        role: 'viewer',
      }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      updateMemberRole(fx.owner.actor, {
        projectId: fx.projectId,
        memberId: await memberIdOf(fx.viewer.user.id),
        role: 'root' as never,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('removeMember', () => {
  it('lets owners remove members and audits it', async () => {
    const memberId = await memberIdOf(fx.viewer.user.id)
    await removeMember(fx.owner.actor, { projectId: fx.projectId, memberId })
    expect(await roleOf(fx.viewer.user.id)).toBeNull()
    expect(await listProjectsForUser(fx.viewer.user.id)).toEqual([])
    const [entry] = await auditEntries('member.removed')
    expect(entry).toMatchObject({ entityId: memberId, entityKey: fx.viewer.user.email })
    expect(entry?.before).toEqual({ role: 'viewer' })
  })

  it('does not let editors remove anyone', async () => {
    await expect(
      removeMember(fx.editor.actor, {
        projectId: fx.projectId,
        memberId: await memberIdOf(fx.viewer.user.id),
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      removeMember(fx.editor.actor, {
        projectId: fx.projectId,
        memberId: await memberIdOf(fx.owner.user.id),
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await roleOf(fx.owner.user.id)).toBe('owner')
  })

  it('refuses to remove the last owner with 400', async () => {
    await expect(
      removeMember(fx.owner.actor, {
        projectId: fx.projectId,
        memberId: await memberIdOf(fx.owner.user.id),
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(await roleOf(fx.owner.user.id)).toBe('owner')
  })

  it('404s for unknown members', async () => {
    await expect(
      removeMember(fx.owner.actor, { projectId: fx.projectId, memberId: 'nope' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('leaveProject', () => {
  it('lets editors and viewers leave', async () => {
    await leaveProject(fx.viewer.actor, { projectId: fx.projectId })
    expect(await roleOf(fx.viewer.user.id)).toBeNull()
    await leaveProject(fx.editor.actor, { projectId: fx.projectId })
    expect(await roleOf(fx.editor.user.id)).toBeNull()
    expect(await auditEntries('member.left')).toHaveLength(2)
  })

  it('keeps the last owner in the project until another owner exists', async () => {
    await expect(leaveProject(fx.owner.actor, { projectId: fx.projectId })).rejects.toMatchObject({
      status: 400,
    })
    await updateMemberRole(fx.owner.actor, {
      projectId: fx.projectId,
      memberId: await memberIdOf(fx.editor.user.id),
      role: 'owner',
    })
    await leaveProject(fx.owner.actor, { projectId: fx.projectId })
    expect(await roleOf(fx.owner.user.id)).toBeNull()
    expect(await roleOf(fx.editor.user.id)).toBe('owner')
  })

  it('cannot be used by outsiders', async () => {
    const other = await createProjectFixture('other')
    await expect(
      leaveProject(other.owner.actor, { projectId: fx.projectId }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
