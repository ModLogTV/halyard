import { OPERATORS, type Operator } from '@halyard/engine'
import { z } from 'zod'

export const PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
export const ENVIRONMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9-_]*$/
/** Flag, segment, variant and experiment keys. Mirrors `KEY_PATTERN` in `@halyard/engine`. */
export const ENTITY_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export const projectIdSchema = z.string().min(1, 'Project is required')
export const uuidSchema = z.string().uuid()

export const entityKeySchema = z
  .string()
  .min(1, 'Key is required')
  .max(128, 'Key must be at most 128 characters')
  .regex(
    ENTITY_KEY_PATTERN,
    'Use letters, digits, ".", "_" and "-", starting with a letter or digit',
  )

export const nameSchema = z.string().trim().min(1, 'Name is required').max(200)
export const descriptionSchema = z.string().trim().max(2000)

export const jsonValueSchema = z.json()

export const variantSchema = z.object({
  key: z.string().min(1).max(128),
  value: jsonValueSchema,
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
})

export const attributeConditionSchema = z.object({
  type: z.literal('attribute'),
  attribute: z.string().min(1),
  operator: z.custom<Operator>(
    (value) => typeof value === 'string' && OPERATORS.includes(value as Operator),
    'Unknown operator',
  ),
  value: jsonValueSchema.optional(),
})

export const segmentConditionSchema = z.object({
  type: z.literal('segment'),
  segmentKey: z.string().min(1),
  negate: z.boolean().optional(),
})

export const conditionSchema = z.discriminatedUnion('type', [
  attributeConditionSchema,
  segmentConditionSchema,
])

export const rolloutVariationSchema = z.object({
  variant: z.string().min(1),
  weight: z.number(),
})

export const serveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('variant'), variant: z.string().min(1) }),
  z.object({
    type: z.literal('rollout'),
    variations: z.array(rolloutVariationSchema),
    bucketBy: z.string().optional(),
  }),
])

/** A rule as submitted by clients. Rules without an `id` get one assigned on save. */
export const ruleInputSchema = z.object({
  id: z.string().min(1).optional(),
  description: z.string().max(1000).optional(),
  conditions: z.array(conditionSchema),
  serve: serveSchema,
})
