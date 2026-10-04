import { z } from 'zod'
import { PROJECT_ROLES } from '@/lib/permissions'
import { projectIdSchema } from './common'

export const projectRoleSchema = z.enum(PROJECT_ROLES)

export const listMembersSchema = z.object({ projectId: projectIdSchema })

export const inviteMemberSchema = z.object({
  projectId: projectIdSchema,
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: projectRoleSchema,
})
export type InviteMemberInput = z.input<typeof inviteMemberSchema>

export const cancelInvitationSchema = z.object({
  projectId: projectIdSchema,
  invitationId: z.string().min(1),
})

export const invitationRefSchema = z.object({ invitationId: z.string().min(1) })

export const updateMemberRoleSchema = z.object({
  projectId: projectIdSchema,
  memberId: z.string().min(1),
  role: projectRoleSchema,
})
export type UpdateMemberRoleInput = z.input<typeof updateMemberRoleSchema>

export const removeMemberSchema = z.object({
  projectId: projectIdSchema,
  memberId: z.string().min(1),
})
export const leaveProjectSchema = z.object({ projectId: projectIdSchema })
