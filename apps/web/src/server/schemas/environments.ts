import { z } from 'zod'
import {
  ENVIRONMENT_KEY_PATTERN,
  HEX_COLOR_PATTERN,
  nameSchema,
  projectIdSchema,
  uuidSchema,
} from './common'

export const environmentKeySchema = z
  .string()
  .min(1, 'Key is required')
  .max(64)
  .regex(
    ENVIRONMENT_KEY_PATTERN,
    'Use lowercase letters, digits, "-" and "_", starting with a letter or digit',
  )

export const colorSchema = z
  .string()
  .regex(HEX_COLOR_PATTERN, 'Color must be a hex value such as #3b82f6')

export const listEnvironmentsSchema = z.object({ projectId: projectIdSchema })

export const createEnvironmentSchema = z.object({
  projectId: projectIdSchema,
  key: environmentKeySchema,
  name: nameSchema,
  color: colorSchema.optional(),
  isProduction: z.boolean().optional(),
})
export type CreateEnvironmentInput = z.input<typeof createEnvironmentSchema>

export const updateEnvironmentSchema = z.object({
  projectId: projectIdSchema,
  environmentId: uuidSchema,
  patch: z
    .object({
      name: nameSchema.optional(),
      color: colorSchema.optional(),
      isProduction: z.boolean().optional(),
    })
    .strict(),
})
export type UpdateEnvironmentInput = z.input<typeof updateEnvironmentSchema>

export const deleteEnvironmentSchema = z.object({
  projectId: projectIdSchema,
  environmentId: uuidSchema,
})

export const reorderEnvironmentsSchema = z.object({
  projectId: projectIdSchema,
  environmentIds: z.array(uuidSchema).min(1),
})
