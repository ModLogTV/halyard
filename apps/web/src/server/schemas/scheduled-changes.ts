import { z } from 'zod'
import { projectIdSchema, ruleInputSchema, serveSchema, uuidSchema } from './common'

export const SCHEDULED_CHANGE_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const
export const scheduledChangeStatusSchema = z.enum(SCHEDULED_CHANGE_STATUSES)

/** The part of a flag's environment configuration a scheduled change sets. */
export const scheduledChangePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    fallthrough: serveSchema.optional(),
    rules: z.array(ruleInputSchema).optional(),
  })
  .strict()
export type ScheduledChangePatchInput = z.input<typeof scheduledChangePatchSchema>

export const noteSchema = z.string().trim().max(1000)

export const createScheduledChangeSchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1),
  environmentKey: z.string().min(1),
  scheduledFor: z.coerce.date(),
  change: scheduledChangePatchSchema,
  note: noteSchema.optional(),
})
export type CreateScheduledChangeInput = z.input<typeof createScheduledChangeSchema>

export const stagedRolloutStepSchema = z.object({
  /** Share of traffic (0–100) that gets the rolled-out variant from `at` on. */
  percentage: z
    .number()
    .min(0, 'Percentage must be between 0 and 100')
    .max(100, 'Percentage must be between 0 and 100'),
  at: z.coerce.date(),
})

export const createStagedRolloutSchema = z
  .object({
    projectId: projectIdSchema,
    flagKey: z.string().min(1),
    environmentKey: z.string().min(1),
    variant: z.string().min(1),
    steps: z.array(stagedRolloutStepSchema).min(1, 'Add at least one step').max(50),
    note: noteSchema.optional(),
  })
  .superRefine((value, ctx) => {
    for (let i = 1; i < value.steps.length; i += 1) {
      const previous = value.steps[i - 1]
      const step = value.steps[i]
      if (previous && step && step.at.getTime() <= previous.at.getTime()) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'at'],
          message: 'Steps must be in strictly increasing time order',
        })
      }
    }
  })
export type CreateStagedRolloutInput = z.input<typeof createStagedRolloutSchema>

export const listScheduledChangesSchema = z.object({
  projectId: projectIdSchema,
  flagKey: z.string().min(1).optional(),
  environmentKey: z.string().min(1).optional(),
  status: scheduledChangeStatusSchema.optional(),
  /** Also return completed, failed and cancelled changes. Ignored when `status` is set. */
  includePast: z.boolean().optional(),
})
export type ListScheduledChangesInput = z.input<typeof listScheduledChangesSchema>

export const updateScheduledChangeSchema = z.object({
  projectId: projectIdSchema,
  id: uuidSchema,
  patch: z
    .object({
      scheduledFor: z.coerce.date().optional(),
      change: scheduledChangePatchSchema.optional(),
      note: noteSchema.nullable().optional(),
    })
    .strict(),
})
export type UpdateScheduledChangeInput = z.input<typeof updateScheduledChangeSchema>

export const scheduledChangeRefSchema = z.object({ projectId: projectIdSchema, id: uuidSchema })
export type ScheduledChangeRefInput = z.input<typeof scheduledChangeRefSchema>

export const scheduledPlanRefSchema = z.object({ projectId: projectIdSchema, planId: uuidSchema })
export type ScheduledPlanRefInput = z.input<typeof scheduledPlanRefSchema>
