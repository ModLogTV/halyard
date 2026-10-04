import { createServerFn } from '@tanstack/react-start'
import { projectActor, userActor } from '@/server/request-actor'
import {
  cancelInvitationSchema,
  invitationRefSchema,
  inviteMemberSchema,
  leaveProjectSchema,
  listMembersSchema,
  removeMemberSchema,
  updateMemberRoleSchema,
} from '@/server/schemas/members'
import * as members from '@/server/services/members'

export const listMembers = createServerFn({ method: 'GET' })
  .validator(listMembersSchema)
  .handler(async ({ data }) =>
    members.listMembers(await projectActor(data.projectId, { project: ['read'] }), data),
  )

export const inviteMember = createServerFn({ method: 'POST' })
  .validator(inviteMemberSchema)
  .handler(async ({ data }) =>
    members.inviteMember(await projectActor(data.projectId, { invitation: ['create'] }), data),
  )

export const cancelInvitation = createServerFn({ method: 'POST' })
  .validator(cancelInvitationSchema)
  .handler(async ({ data }) =>
    members.cancelInvitation(await projectActor(data.projectId, { invitation: ['cancel'] }), data),
  )

/** Pending invitations addressed to the signed-in user. */
export const listMyInvitations = createServerFn({ method: 'GET' }).handler(async () =>
  members.listMyInvitations(await userActor()),
)

export const acceptInvitation = createServerFn({ method: 'POST' })
  .validator(invitationRefSchema)
  .handler(async ({ data }) => members.acceptInvitation(await userActor(), data))

export const rejectInvitation = createServerFn({ method: 'POST' })
  .validator(invitationRefSchema)
  .handler(async ({ data }) => members.rejectInvitation(await userActor(), data))

export const updateMemberRole = createServerFn({ method: 'POST' })
  .validator(updateMemberRoleSchema)
  .handler(async ({ data }) =>
    members.updateMemberRole(await projectActor(data.projectId, { member: ['update'] }), data),
  )

export const removeMember = createServerFn({ method: 'POST' })
  .validator(removeMemberSchema)
  .handler(async ({ data }) =>
    members.removeMember(await projectActor(data.projectId, { member: ['delete'] }), data),
  )

export const leaveProject = createServerFn({ method: 'POST' })
  .validator(leaveProjectSchema)
  .handler(async ({ data }) => members.leaveProject(await projectActor(data.projectId), data))
