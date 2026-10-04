import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import { listAuditLogSchema, listFlagHistorySchema } from '@/server/schemas/audit'
import * as audit from '@/server/services/audit-log'

export const listAuditLog = createServerFn({ method: 'GET' })
  .inputValidator(listAuditLogSchema)
  .handler(async ({ data }) =>
    audit.listAuditLog(await projectActor(data.projectId, { audit: ['read'] }), data),
  )

export const listFlagHistory = createServerFn({ method: 'GET' })
  .inputValidator(listFlagHistorySchema)
  .handler(async ({ data }) =>
    audit.listFlagHistory(await projectActor(data.projectId, { audit: ['read'] }), data),
  )
