import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import {
  createScheduledChangeSchema,
  createStagedRolloutSchema,
  listScheduledChangesSchema,
  scheduledChangeRefSchema,
  scheduledPlanRefSchema,
  updateScheduledChangeSchema,
} from '@/server/schemas/scheduled-changes'
import { permissionsForEnvironmentPatch } from '@/server/services/flags'
import * as schedules from '@/server/services/scheduled-changes'

export const listScheduledChanges = createServerFn({ method: 'GET' })
  .validator(listScheduledChangesSchema)
  .handler(async ({ data }) =>
    schedules.listScheduledChanges(
      await projectActor(data.projectId, { schedule: ['read'] }),
      data,
    ),
  )

/** Needs `schedule:create` plus what applying the change needs (`flag:toggle` or `flag:update`). */
export const createScheduledChange = createServerFn({ method: 'POST' })
  .validator(createScheduledChangeSchema)
  .handler(async ({ data }) =>
    schedules.createScheduledChange(
      await projectActor(data.projectId, {
        schedule: ['create'],
        ...permissionsForEnvironmentPatch(data.change),
      }),
      data,
    ),
  )

export const createStagedRollout = createServerFn({ method: 'POST' })
  .validator(createStagedRolloutSchema)
  .handler(async ({ data }) =>
    schedules.createStagedRollout(
      await projectActor(data.projectId, { schedule: ['create'], flag: ['update'] }),
      data,
    ),
  )

export const updateScheduledChange = createServerFn({ method: 'POST' })
  .validator(updateScheduledChangeSchema)
  .handler(async ({ data }) =>
    schedules.updateScheduledChange(
      await projectActor(data.projectId, {
        schedule: ['update'],
        ...(data.patch.change ? permissionsForEnvironmentPatch(data.patch.change) : {}),
      }),
      data,
    ),
  )

export const cancelScheduledChange = createServerFn({ method: 'POST' })
  .validator(scheduledChangeRefSchema)
  .handler(async ({ data }) =>
    schedules.cancelScheduledChange(
      await projectActor(data.projectId, { schedule: ['delete'] }),
      data,
    ),
  )

export const cancelPlan = createServerFn({ method: 'POST' })
  .validator(scheduledPlanRefSchema)
  .handler(async ({ data }) =>
    schedules.cancelPlan(await projectActor(data.projectId, { schedule: ['delete'] }), data),
  )
