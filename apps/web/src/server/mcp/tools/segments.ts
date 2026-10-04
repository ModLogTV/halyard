import { z } from 'zod'
import { entityKeySchema } from '@/server/schemas/common'
import {
  createSegment,
  deleteSegment,
  getSegment,
  listSegments,
  updateSegment,
} from '@/server/services/segments'
import { segmentInput, segmentKey } from '../schemas'
import { defineTool } from '../tools'

export const segmentTools = [
  defineTool({
    name: 'list_segments',
    title: 'List segments',
    description:
      'Segments of the project: reusable groups of users defined by attribute conditions, referenced from flag rules.',
    kind: 'read',
    input: z.object({}),
    run: (_input, { actor, projectId }) => listSegments(actor, { projectId }),
  }),

  defineTool({
    name: 'get_segment',
    title: 'Get segment',
    description: 'A segment with its conditions and the flag rules that use it.',
    kind: 'read',
    input: z.object({ segmentKey }),
    run: ({ segmentKey }, { actor, projectId }) => getSegment(actor, { projectId, segmentKey }),
  }),

  defineTool({
    name: 'create_segment',
    title: 'Create segment',
    description:
      'Creates a segment. Reference it from flag rules with a condition { "type": "segment", "segmentKey": "..." }.',
    kind: 'create',
    input: z.object({ key: entityKeySchema, ...segmentInput }),
    run: (input, { actor, projectId }) => createSegment(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'update_segment',
    title: 'Update segment',
    description:
      'Changes a segment. Omitted fields stay unchanged; `conditions` replaces the whole list. Every flag using the segment is affected immediately.',
    kind: 'update',
    input: z.object({
      segmentKey,
      ...segmentInput,
      name: segmentInput.name.optional(),
      description: segmentInput.description.unwrap().nullable().optional(),
      conditions: segmentInput.conditions.optional(),
    }),
    run: ({ segmentKey, ...patch }, { actor, projectId }) =>
      updateSegment(actor, { projectId, segmentKey, patch }),
  }),

  defineTool({
    name: 'delete_segment',
    title: 'Delete segment',
    description: 'Deletes a segment. Fails while flag rules still reference it.',
    kind: 'delete',
    input: z.object({ segmentKey }),
    run: ({ segmentKey }, { actor, projectId }) => deleteSegment(actor, { projectId, segmentKey }),
  }),
]
