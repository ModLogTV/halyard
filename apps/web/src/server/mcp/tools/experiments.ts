import { z } from 'zod'
import { entityKeySchema, nameSchema } from '@/server/schemas/common'
import {
  conversionEventSchema,
  experimentStatusSchema,
  hypothesisSchema,
} from '@/server/schemas/experiments'
import {
  createExperiment,
  deleteExperiment,
  getExperiment,
  listExperiments,
  startExperiment,
  stopExperiment,
  updateExperiment,
} from '@/server/services/experiments'
import { allocation, environmentKey, experimentKey, flagKey } from '../schemas'
import { defineTool } from '../tools'

const conversionEvent = conversionEventSchema.describe(
  'Name of the event applications send to POST /api/v1/track, for example "checkout_completed"',
)
const controlVariant = z.string().min(1).describe('Variant the others are compared with')

export const experimentTools = [
  defineTool({
    name: 'list_experiments',
    title: 'List experiments',
    description: 'A/B experiments of the project with exposure and conversion counts.',
    kind: 'read',
    input: z.object({
      flagKey: flagKey.optional(),
      environmentKey: environmentKey.optional(),
      status: experimentStatusSchema.optional(),
    }),
    run: (input, { actor, projectId }) => listExperiments(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'get_experiment',
    title: 'Get experiment',
    description:
      'An experiment with its results per variant: exposures, conversions, conversion rate, lift against the control, p-value and verdict.',
    kind: 'read',
    input: z.object({ experimentKey }),
    run: ({ experimentKey }, { actor, projectId }) =>
      getExperiment(actor, { projectId, experimentKey }),
  }),

  defineTool({
    name: 'create_experiment',
    title: 'Create experiment',
    description:
      'Creates a draft experiment on a flag in one environment. Nothing changes for users until start_experiment.',
    kind: 'create',
    input: z.object({
      flagKey,
      environmentKey,
      key: entityKeySchema,
      name: nameSchema,
      hypothesis: hypothesisSchema.optional(),
      allocation,
      conversionEvent,
      controlVariant,
    }),
    run: (input, { actor, projectId }) => createExperiment(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'update_experiment',
    title: 'Update experiment',
    description:
      'Changes an experiment. Name and hypothesis can always change; allocation, conversion event and control variant only while it is a draft.',
    kind: 'update',
    input: z.object({
      experimentKey,
      name: nameSchema.optional(),
      hypothesis: hypothesisSchema.nullable().optional(),
      allocation: allocation.optional(),
      conversionEvent: conversionEvent.optional(),
      controlVariant: controlVariant.optional(),
    }),
    run: ({ experimentKey, ...patch }, { actor, projectId }) =>
      updateExperiment(actor, { projectId, experimentKey, patch }),
  }),

  defineTool({
    name: 'start_experiment',
    title: 'Start experiment',
    description:
      'Starts a draft experiment: the flag then serves the allocation to users in that environment. Only one experiment can run per flag and environment.',
    kind: 'update',
    input: z.object({ experimentKey }),
    run: ({ experimentKey }, { actor, projectId }) =>
      startExperiment(actor, { projectId, experimentKey }),
  }),

  defineTool({
    name: 'stop_experiment',
    title: 'Stop experiment',
    description:
      'Stops a running experiment; the flag serves its own configuration again. A stopped experiment cannot be restarted.',
    kind: 'update',
    input: z.object({ experimentKey }),
    run: ({ experimentKey }, { actor, projectId }) =>
      stopExperiment(actor, { projectId, experimentKey }),
  }),

  defineTool({
    name: 'delete_experiment',
    title: 'Delete experiment',
    description:
      'Deletes a draft or stopped experiment together with its recorded exposures and conversions.',
    kind: 'delete',
    input: z.object({ experimentKey }),
    run: ({ experimentKey }, { actor, projectId }) =>
      deleteExperiment(actor, { projectId, experimentKey }),
  }),
]
