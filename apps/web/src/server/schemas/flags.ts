import { z } from 'zod'
import {
  descriptionSchema,
  entityKeySchema,
  nameSchema,
  projectIdSchema,
  ruleInputSchema,
  serveSchema,
  variantSchema,
} from './common'

export const flagTypeSchema = z.enum(['boolean', 'string', 'number', 'json'])

export const tagSchema = z.string().trim().min(1).max(50)
export const tagsSchema = z.array(tagSchema).max(50)

export const createFlagSchema = z.object({
  projectId: projectIdSchema,
  key: entityKeySchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  type: flagTypeSchema,
  /** Optional for boolean flags, which default to `on` (true) and `off` (false). */
  variants: z.array(variantSchema).optional(),
  tags: tagsSchema.optional(),
  offVariant: z.string().min(1).optional(),
  defaultVariant: z.string().min(1).optional(),
})
export type CreateFlagInput = z.input<typeof createFlagSchema>

export const listFlagsSchema = z.object({
  projectId: projectIdSchema,
  search: z.string().optional(),
  /** Matches flags carrying at least one of these tags. */
  tags: z.array(z.string()).optional(),
  type: flagTypeSchema.optional(),
  includeArchived: z.boolean().optional(),
})
export type ListFlagsInput = z.input<typeof listFlagsSchema>

export const flagRefSchema = z.object({ projectId: projectIdSchema, flagKey: z.string().min(1) })

export const updateFlagSchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1),
  patch: z
    .object({
      name: nameSchema.optional(),
      description: descriptionSchema.nullable().optional(),
      tags: tagsSchema.optional(),
      variants: z.array(variantSchema).optional(),
    })
    .strict(),
})
export type UpdateFlagInput = z.input<typeof updateFlagSchema>

export const environmentConfigPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    offVariant: z.string().min(1).optional(),
    fallthrough: serveSchema.optional(),
    rules: z.array(ruleInputSchema).optional(),
  })
  .strict()
export type EnvironmentConfigPatch = z.input<typeof environmentConfigPatchSchema>

export const updateFlagEnvironmentSchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1),
  environmentKey: z.string().min(1),
  patch: environmentConfigPatchSchema,
  expectedVersion: z.number().int().min(1).optional(),
})
export type UpdateFlagEnvironmentInput = z.input<typeof updateFlagEnvironmentSchema>

export const toggleFlagSchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1),
  environmentKey: z.string().min(1),
  enabled: z.boolean(),
  expectedVersion: z.number().int().min(1).optional(),
})

export const COPYABLE_FIELDS = ['enabled', 'offVariant', 'fallthrough', 'rules'] as const
export type CopyableField = (typeof COPYABLE_FIELDS)[number]

export const copyFlagEnvironmentSchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1),
  fromEnvironmentKey: z.string().min(1),
  toEnvironmentKey: z.string().min(1),
  fields: z.array(z.enum(COPYABLE_FIELDS)).min(1).optional(),
})
export type CopyFlagEnvironmentInput = z.input<typeof copyFlagEnvironmentSchema>
