import { OPERATORS, type Operator } from '@modlogtv/halyard-engine'
import { z } from 'zod'
import { descriptionSchema, entityKeySchema, nameSchema } from '../schemas/common'
import { flagTypeSchema, tagsSchema } from '../schemas/flags'

/**
 * Input schemas of the MCP tools. They mirror `src/server/schemas/*` without
 * `projectId` (the management key decides the project) and carry descriptions,
 * because agents only see the JSON Schema. Everything is representable in JSON
 * Schema: no `z.custom`, no dates (timestamps are ISO strings). Services still
 * validate with their own schemas.
 */

export const flagKey = z.string().min(1).describe('Key of the flag')
export const environmentKey = z
  .string()
  .min(1)
  .describe('Key of the environment, for example "production" (see get_project)')
export const segmentKey = z.string().min(1).describe('Key of the segment')
export const experimentKey = z.string().min(1).describe('Key of the experiment')
export const timestamp = z.iso
  .datetime({ offset: true })
  .describe('ISO 8601 timestamp with timezone, for example "2026-10-05T09:00:00Z"')

export const variant = z.object({
  key: z.string().min(1).max(128).describe('Variant key, unique within the flag'),
  value: z.json().describe('Value served for this variant; must match the flag type'),
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
})

export const attributeCondition = z
  .object({
    type: z.literal('attribute'),
    attribute: z
      .string()
      .min(1)
      .describe('Evaluation context attribute, for example "email", "plan" or "targetingKey"'),
    operator: z.enum(OPERATORS as [Operator, ...Operator[]]),
    value: z
      .json()
      .optional()
      .describe(
        'Value to compare with: an array for in/not_in, a regex string for regex, a semver string for semver_*; omit for exists/not_exists',
      ),
  })
  .describe('Matches an attribute of the evaluation context')

export const segmentCondition = z
  .object({
    type: z.literal('segment'),
    segmentKey: z.string().min(1),
    negate: z.boolean().optional().describe('Match contexts that are NOT in the segment'),
  })
  .describe('Matches contexts in a segment of the project')

export const serve = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('variant'), variant: z.string().min(1) }),
    z.object({
      type: z.literal('rollout'),
      variations: z
        .array(z.object({ variant: z.string().min(1), weight: z.number() }))
        .describe('Percentage per variant; weights must add up to 100'),
      bucketBy: z
        .string()
        .optional()
        .describe('Context attribute used for sticky bucketing (default "targetingKey")'),
    }),
  ])
  .describe('What to serve: one variant, or a sticky percentage rollout across variants')

export const rule = z.object({
  id: z
    .string()
    .min(1)
    .optional()
    .describe('Keep the id of existing rules; new rules get one assigned'),
  description: z.string().max(1000).optional(),
  conditions: z
    .array(z.discriminatedUnion('type', [attributeCondition, segmentCondition]))
    .describe('All conditions must match (AND); an empty list matches everyone'),
  serve,
})

export const rules = z
  .array(rule)
  .describe('Targeting rules, evaluated in order; the first matching rule decides')

export const createFlagInput = z.object({
  key: entityKeySchema.describe('Unique flag key used by SDKs, for example "new-checkout"'),
  name: nameSchema,
  description: descriptionSchema.optional(),
  type: flagTypeSchema,
  variants: z
    .array(variant)
    .optional()
    .describe('Required except for boolean flags, which default to on (true) and off (false)'),
  tags: tagsSchema.optional(),
  offVariant: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Variant served while the flag is disabled (default: the false variant of boolean flags, otherwise the last variant)',
    ),
  defaultVariant: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Variant the fallthrough serves once enabled (default: the first variant that is not the off variant)',
    ),
})

export const updateFlagInput = z.object({
  flagKey,
  name: nameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  tags: tagsSchema.optional().describe('Replaces all tags'),
  variants: z
    .array(variant)
    .optional()
    .describe('Replaces all variants; variants still in use cannot be removed'),
})

export const updateFlagEnvironmentInput = z.object({
  flagKey,
  environmentKey,
  enabled: z.boolean().optional(),
  offVariant: z.string().min(1).optional().describe('Variant served while disabled'),
  fallthrough: serve.optional().describe('Served when the flag is enabled and no rule matches'),
  rules: rules.optional().describe('Replaces all rules; pass the full list'),
  expectedVersion: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Version from get_flag; the change fails if someone changed the configuration in between',
    ),
})

export const segmentInput = {
  name: nameSchema,
  description: descriptionSchema.optional(),
  match: z
    .enum(['all', 'any'])
    .optional()
    .describe('Whether all (default) or any of the conditions must match'),
  conditions: z.array(attributeCondition),
}

export const allocation = z
  .array(z.object({ variant: z.string().min(1), weight: z.number() }))
  .min(1)
  .describe('Variants and their share of subjects; weights must add up to 100')

export const scheduledChange = z
  .object({
    enabled: z.boolean().optional(),
    fallthrough: serve.optional(),
    rules: rules.optional(),
  })
  .describe('The part of the flag configuration to set when the change runs')
