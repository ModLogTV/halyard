import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import {
  createEnvironmentSchema,
  deleteEnvironmentSchema,
  listEnvironmentsSchema,
  reorderEnvironmentsSchema,
  updateEnvironmentSchema,
} from '@/server/schemas/environments'
import * as environments from '@/server/services/environments'

export const listEnvironments = createServerFn({ method: 'GET' })
  .validator(listEnvironmentsSchema)
  .handler(async ({ data }) =>
    environments.listEnvironments(
      await projectActor(data.projectId, { environment: ['read'] }),
      data,
    ),
  )

export const createEnvironment = createServerFn({ method: 'POST' })
  .validator(createEnvironmentSchema)
  .handler(async ({ data }) =>
    environments.createEnvironment(
      await projectActor(data.projectId, { environment: ['create'] }),
      data,
    ),
  )

export const updateEnvironment = createServerFn({ method: 'POST' })
  .validator(updateEnvironmentSchema)
  .handler(async ({ data }) =>
    environments.updateEnvironment(
      await projectActor(data.projectId, { environment: ['update'] }),
      data,
    ),
  )

export const deleteEnvironment = createServerFn({ method: 'POST' })
  .validator(deleteEnvironmentSchema)
  .handler(async ({ data }) =>
    environments.deleteEnvironment(
      await projectActor(data.projectId, { environment: ['delete'] }),
      data,
    ),
  )

export const reorderEnvironments = createServerFn({ method: 'POST' })
  .validator(reorderEnvironmentsSchema)
  .handler(async ({ data }) =>
    environments.reorderEnvironments(
      await projectActor(data.projectId, { environment: ['update'] }),
      data,
    ),
  )
