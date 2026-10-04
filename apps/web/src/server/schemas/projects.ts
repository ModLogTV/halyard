import { z } from 'zod'
import { descriptionSchema, PROJECT_SLUG_PATTERN, projectIdSchema } from './common'

export const projectNameSchema = z.string().trim().min(1, 'Name is required').max(100)

export const projectSlugSchema = z
  .string()
  .min(1, 'Slug is required')
  .max(63)
  .regex(
    PROJECT_SLUG_PATTERN,
    'Use lowercase letters, digits and "-", not starting or ending with "-"',
  )

export const createProjectSchema = z.object({
  name: projectNameSchema,
  slug: projectSlugSchema,
  description: descriptionSchema.optional(),
})
export type CreateProjectInput = z.input<typeof createProjectSchema>

export const getProjectSchema = z.object({ slug: z.string().min(1) })

export const updateProjectSchema = z.object({
  projectId: projectIdSchema,
  patch: z
    .object({
      name: projectNameSchema.optional(),
      description: descriptionSchema.nullable().optional(),
      staleAfterDays: z.number().int().min(1).max(3650).optional(),
      singleVariantAfterDays: z.number().int().min(1).max(3650).optional(),
    })
    .strict(),
})
export type UpdateProjectInput = z.input<typeof updateProjectSchema>

export const deleteProjectSchema = z.object({ projectId: projectIdSchema })
