import { z } from 'zod'
import {
  attributeConditionSchema,
  descriptionSchema,
  entityKeySchema,
  nameSchema,
  projectIdSchema,
} from './common'

export const segmentMatchSchema = z.enum(['all', 'any'])

export const listSegmentsSchema = z.object({ projectId: projectIdSchema })
export const segmentRefSchema = z.object({
  projectId: projectIdSchema,
  segmentKey: z.string().min(1),
})

export const createSegmentSchema = z.object({
  projectId: projectIdSchema,
  key: entityKeySchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  match: segmentMatchSchema.optional(),
  conditions: z.array(attributeConditionSchema),
})
export type CreateSegmentInput = z.input<typeof createSegmentSchema>

export const updateSegmentSchema = z.object({
  projectId: projectIdSchema,
  segmentKey: z.string().min(1),
  patch: z
    .object({
      name: nameSchema.optional(),
      description: descriptionSchema.nullable().optional(),
      match: segmentMatchSchema.optional(),
      conditions: z.array(attributeConditionSchema).optional(),
    })
    .strict(),
})
export type UpdateSegmentInput = z.input<typeof updateSegmentSchema>
