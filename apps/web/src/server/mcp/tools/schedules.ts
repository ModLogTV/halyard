import { z } from 'zod'
import { noteSchema, scheduledChangeStatusSchema } from '@/server/schemas/scheduled-changes'
import {
  cancelPlan,
  cancelScheduledChange,
  createScheduledChange,
  createStagedRollout,
  listScheduledChanges,
  updateScheduledChange,
} from '@/server/services/scheduled-changes'
import { environmentKey, flagKey, scheduledChange, timestamp } from '../schemas'
import { defineTool } from '../tools'

const scheduledChangeId = z.uuid().describe('Id of the scheduled change')

export const scheduleTools = [
  defineTool({
    name: 'list_scheduled_changes',
    title: 'List scheduled changes',
    description:
      'Scheduled flag changes and staged rollout steps, ordered by time. Without `status` only pending and running ones unless `includePast` is set.',
    kind: 'read',
    input: z.object({
      flagKey: flagKey.optional(),
      environmentKey: environmentKey.optional(),
      status: scheduledChangeStatusSchema.optional(),
      includePast: z.boolean().optional(),
    }),
    run: (input, { actor, projectId }) => listScheduledChanges(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'schedule_flag_change',
    title: 'Schedule flag change',
    description:
      'Schedules a change to a flag in one environment (enable or disable, new fallthrough or rules) at a future time.',
    kind: 'create',
    input: z.object({
      flagKey,
      environmentKey,
      scheduledFor: timestamp.describe('When to apply the change; must be in the future'),
      change: scheduledChange,
      note: noteSchema.optional(),
    }),
    run: (input, { actor, projectId }) => createScheduledChange(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'schedule_staged_rollout',
    title: 'Schedule staged rollout',
    description:
      'Rolls a variant out in steps, for example 10 % today, 50 % tomorrow, 100 % the day after. Each step enables the flag and sets the fallthrough to a sticky rollout giving `variant` the step percentage; the other variants share the rest.',
    kind: 'create',
    input: z.object({
      flagKey,
      environmentKey,
      variant: z.string().min(1).describe('Variant to roll out'),
      steps: z
        .array(
          z.object({
            percentage: z.number().min(0).max(100),
            at: timestamp.describe('When this step applies; steps in increasing time order'),
          }),
        )
        .min(1)
        .max(50),
      note: noteSchema.optional(),
    }),
    run: (input, { actor, projectId }) => createStagedRollout(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'update_scheduled_change',
    title: 'Update scheduled change',
    description:
      'Changes the time, the change or the note of a pending scheduled change. Omitted fields stay unchanged.',
    kind: 'update',
    input: z.object({
      id: scheduledChangeId,
      scheduledFor: timestamp.optional(),
      change: scheduledChange.optional(),
      note: noteSchema.nullable().optional(),
    }),
    run: ({ id, ...patch }, { actor, projectId }) =>
      updateScheduledChange(actor, { projectId, id, patch }),
  }),

  defineTool({
    name: 'cancel_scheduled_change',
    title: 'Cancel scheduled change',
    description:
      'Cancels one pending scheduled change. Other steps of its staged rollout stay scheduled.',
    kind: 'delete',
    input: z.object({ id: scheduledChangeId }),
    run: ({ id }, { actor, projectId }) => cancelScheduledChange(actor, { projectId, id }),
  }),

  defineTool({
    name: 'cancel_staged_rollout',
    title: 'Cancel staged rollout',
    description: 'Cancels every pending step of a staged rollout. Steps that already ran are kept.',
    kind: 'delete',
    input: z.object({ planId: z.uuid().describe('`planId` of the staged rollout') }),
    run: ({ planId }, { actor, projectId }) => cancelPlan(actor, { projectId, planId }),
  }),
]
