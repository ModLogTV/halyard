import { z } from 'zod'
import { entityKeySchema, nameSchema, projectIdSchema, rolloutVariationSchema } from './common'

export const experimentStatusSchema = z.enum(['draft', 'running', 'stopped'])
export type ExperimentStatus = z.infer<typeof experimentStatusSchema>

export const hypothesisSchema = z.string().trim().max(2000)
export const conversionEventSchema = z
  .string()
  .trim()
  .min(1, 'Conversion event is required')
  .max(200, 'Conversion event must be at most 200 characters')
/** Variants and weights (summing to 100) the experiment allocates subjects to. */
export const allocationSchema = z
  .array(rolloutVariationSchema)
  .min(1, 'Allocate at least one variant')

export const listExperimentsSchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1).optional(),
  environmentKey: z.string().min(1).optional(),
  status: experimentStatusSchema.optional(),
})
export type ListExperimentsInput = z.input<typeof listExperimentsSchema>

export const experimentRefSchema = z.object({
  projectId: projectIdSchema,
  experimentKey: z.string().min(1),
})
export type ExperimentRefInput = z.input<typeof experimentRefSchema>

export const createExperimentSchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1),
  environmentKey: z.string().min(1),
  key: entityKeySchema,
  name: nameSchema,
  hypothesis: hypothesisSchema.optional(),
  allocation: allocationSchema,
  conversionEvent: conversionEventSchema,
  controlVariant: z.string().min(1, 'Control variant is required'),
})
export type CreateExperimentInput = z.input<typeof createExperimentSchema>

export const updateExperimentSchema = z.object({
  projectId: projectIdSchema,
  experimentKey: z.string().min(1),
  patch: z
    .object({
      name: nameSchema.optional(),
      hypothesis: hypothesisSchema.nullable().optional(),
      allocation: allocationSchema.optional(),
      conversionEvent: conversionEventSchema.optional(),
      controlVariant: z.string().min(1).optional(),
    })
    .strict(),
})
export type UpdateExperimentInput = z.input<typeof updateExperimentSchema>

/** Maximum number of events in one `POST /api/v1/track` request. */
export const MAX_TRACK_BATCH = 100

export const trackEventSchema = z.object({
  event: z.string().trim().min(1, 'event is required').max(200),
  targetingKey: z.string().min(1, 'targetingKey is required').max(1024),
  /** Accepted for forward compatibility; not stored yet. */
  value: z.number().finite().optional(),
  /** ISO 8601 time of the conversion; defaults to the time of receipt. */
  timestamp: z.iso.datetime({ offset: true }).optional(),
})
export type TrackEvent = z.output<typeof trackEventSchema>

export const trackBodySchema = z.union([
  trackEventSchema,
  z
    .array(trackEventSchema)
    .min(1, 'Send at least one event')
    .max(MAX_TRACK_BATCH, `Send at most ${MAX_TRACK_BATCH} events per request`),
])
