import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import {
  exportFlagdSchema,
  exportProjectSchema,
  importDocumentSchema,
} from '@/server/schemas/transfer'
import * as transfer from '@/server/services/transfer'

export const exportProject = createServerFn({ method: 'POST' })
  .inputValidator(exportProjectSchema)
  .handler(async ({ data }) =>
    transfer.exportProject(await projectActor(data.projectId, { transfer: ['export'] }), data),
  )

export const exportFlagd = createServerFn({ method: 'POST' })
  .inputValidator(exportFlagdSchema)
  .handler(async ({ data }) =>
    transfer.exportFlagd(await projectActor(data.projectId, { transfer: ['export'] }), data),
  )

export const previewImport = createServerFn({ method: 'POST' })
  .inputValidator(importDocumentSchema)
  .handler(async ({ data }) =>
    transfer.previewImport(await projectActor(data.projectId, { transfer: ['import'] }), data),
  )

export const applyImport = createServerFn({ method: 'POST' })
  .inputValidator(importDocumentSchema)
  .handler(async ({ data }) =>
    transfer.applyImport(await projectActor(data.projectId, { transfer: ['import'] }), data),
  )
