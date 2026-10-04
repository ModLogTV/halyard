import { z } from 'zod'
import { projectIdSchema } from './common'

export const listAuditLogSchema = z.object({
  projectId: projectIdSchema,
  environmentId: z.string().uuid().optional(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  /** Exact action such as `flag.updated`, or a prefix pattern such as `flag.*`. */
  action: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
})
export type ListAuditLogInput = z.input<typeof listAuditLogSchema>

export const listFlagHistorySchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
})
