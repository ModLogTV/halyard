import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import {
  copyFlagEnvironmentSchema,
  createFlagSchema,
  flagRefSchema,
  listFlagsSchema,
  toggleFlagSchema,
  updateFlagEnvironmentSchema,
  updateFlagSchema,
} from '@/server/schemas/flags'
import * as flags from '@/server/services/flags'

export const listFlags = createServerFn({ method: 'GET' })
  .inputValidator(listFlagsSchema)
  .handler(async ({ data }) =>
    flags.listFlags(await projectActor(data.projectId, { flag: ['read'] }), data),
  )

export const getFlag = createServerFn({ method: 'GET' })
  .inputValidator(flagRefSchema)
  .handler(async ({ data }) =>
    flags.getFlag(await projectActor(data.projectId, { flag: ['read'] }), data),
  )

export const createFlag = createServerFn({ method: 'POST' })
  .inputValidator(createFlagSchema)
  .handler(async ({ data }) =>
    flags.createFlag(await projectActor(data.projectId, { flag: ['create'] }), data),
  )

export const updateFlag = createServerFn({ method: 'POST' })
  .inputValidator(updateFlagSchema)
  .handler(async ({ data }) =>
    flags.updateFlag(await projectActor(data.projectId, { flag: ['update'] }), data),
  )

export const archiveFlag = createServerFn({ method: 'POST' })
  .inputValidator(flagRefSchema)
  .handler(async ({ data }) =>
    flags.archiveFlag(await projectActor(data.projectId, { flag: ['update'] }), data),
  )

export const unarchiveFlag = createServerFn({ method: 'POST' })
  .inputValidator(flagRefSchema)
  .handler(async ({ data }) =>
    flags.unarchiveFlag(await projectActor(data.projectId, { flag: ['update'] }), data),
  )

export const deleteFlag = createServerFn({ method: 'POST' })
  .inputValidator(flagRefSchema)
  .handler(async ({ data }) =>
    flags.deleteFlag(await projectActor(data.projectId, { flag: ['delete'] }), data),
  )

/** `enabled`-only patches need `flag:toggle`; anything else needs `flag:update`. */
export const updateFlagEnvironment = createServerFn({ method: 'POST' })
  .inputValidator(updateFlagEnvironmentSchema)
  .handler(async ({ data }) =>
    flags.updateFlagEnvironment(
      await projectActor(data.projectId, flags.permissionsForEnvironmentPatch(data.patch)),
      data,
    ),
  )

export const toggleFlag = createServerFn({ method: 'POST' })
  .inputValidator(toggleFlagSchema)
  .handler(async ({ data }) =>
    flags.toggleFlag(await projectActor(data.projectId, { flag: ['toggle'] }), data),
  )

export const copyFlagEnvironment = createServerFn({ method: 'POST' })
  .inputValidator(copyFlagEnvironmentSchema)
  .handler(async ({ data }) =>
    flags.copyFlagEnvironment(await projectActor(data.projectId, { flag: ['promote'] }), data),
  )
