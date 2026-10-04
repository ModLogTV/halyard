import { z } from 'zod'
import { projectIdSchema, uuidSchema } from './common'

export const ANALYTICS_RANGES = ['24h', '7d', '30d'] as const
export const analyticsRangeSchema = z.enum(ANALYTICS_RANGES)
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>

export const projectAnalyticsSchema = z.object({
  projectId: projectIdSchema,
  range: analyticsRangeSchema.default('7d'),
  /** Limits the numbers to one environment; all environments when omitted. */
  environmentId: uuidSchema.optional(),
})
export type ProjectAnalyticsInput = z.input<typeof projectAnalyticsSchema>

export const flagAnalyticsSchema = projectAnalyticsSchema.extend({
  flagKey: z.string().min(1),
})
export type FlagAnalyticsInput = z.input<typeof flagAnalyticsSchema>
