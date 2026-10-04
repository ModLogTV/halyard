import { z } from 'zod'
import { jsonValueSchema, projectIdSchema } from './common'

export const exportProjectSchema = z.object({ projectId: projectIdSchema })

export const exportFlagdSchema = z.object({
  projectId: projectIdSchema,
  environmentKey: z.string().min(1, 'Environment is required'),
})
export type ExportFlagdInput = z.input<typeof exportFlagdSchema>

/**
 * Import input. The document is validated in depth by the import itself, which reports
 * problems per entity instead of failing on the first one.
 */
export const importDocumentSchema = z.object({
  projectId: projectIdSchema,
  document: jsonValueSchema,
  /** Also delete flags, segments and environments that are missing from the document. */
  prune: z.boolean().optional(),
})
export type ImportDocumentInput = z.input<typeof importDocumentSchema>
