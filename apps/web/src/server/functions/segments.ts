import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import {
  createSegmentSchema,
  listSegmentsSchema,
  segmentRefSchema,
  updateSegmentSchema,
} from '@/server/schemas/segments'
import * as segments from '@/server/services/segments'

export const listSegments = createServerFn({ method: 'GET' })
  .inputValidator(listSegmentsSchema)
  .handler(async ({ data }) =>
    segments.listSegments(await projectActor(data.projectId, { segment: ['read'] }), data),
  )

export const getSegment = createServerFn({ method: 'GET' })
  .inputValidator(segmentRefSchema)
  .handler(async ({ data }) =>
    segments.getSegment(await projectActor(data.projectId, { segment: ['read'] }), data),
  )

export const createSegment = createServerFn({ method: 'POST' })
  .inputValidator(createSegmentSchema)
  .handler(async ({ data }) =>
    segments.createSegment(await projectActor(data.projectId, { segment: ['create'] }), data),
  )

export const updateSegment = createServerFn({ method: 'POST' })
  .inputValidator(updateSegmentSchema)
  .handler(async ({ data }) =>
    segments.updateSegment(await projectActor(data.projectId, { segment: ['update'] }), data),
  )

/** Fails with 409 `SEGMENT_IN_USE` (and the list of usages) while rules reference the segment. */
export const deleteSegment = createServerFn({ method: 'POST' })
  .inputValidator(segmentRefSchema)
  .handler(async ({ data }) =>
    segments.deleteSegment(await projectActor(data.projectId, { segment: ['delete'] }), data),
  )
