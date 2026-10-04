import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import {
  createExperimentSchema,
  experimentRefSchema,
  listExperimentsSchema,
  updateExperimentSchema,
} from '@/server/schemas/experiments'
import * as experiments from '@/server/services/experiments'

export const listExperiments = createServerFn({ method: 'GET' })
  .validator(listExperimentsSchema)
  .handler(async ({ data }) =>
    experiments.listExperiments(await projectActor(data.projectId, { experiment: ['read'] }), data),
  )

export const getExperiment = createServerFn({ method: 'GET' })
  .validator(experimentRefSchema)
  .handler(async ({ data }) =>
    experiments.getExperiment(await projectActor(data.projectId, { experiment: ['read'] }), data),
  )

export const createExperiment = createServerFn({ method: 'POST' })
  .validator(createExperimentSchema)
  .handler(async ({ data }) =>
    experiments.createExperiment(
      await projectActor(data.projectId, { experiment: ['create'] }),
      data,
    ),
  )

export const updateExperiment = createServerFn({ method: 'POST' })
  .validator(updateExperimentSchema)
  .handler(async ({ data }) =>
    experiments.updateExperiment(
      await projectActor(data.projectId, { experiment: ['update'] }),
      data,
    ),
  )

export const startExperiment = createServerFn({ method: 'POST' })
  .validator(experimentRefSchema)
  .handler(async ({ data }) =>
    experiments.startExperiment(
      await projectActor(data.projectId, { experiment: ['update'] }),
      data,
    ),
  )

export const stopExperiment = createServerFn({ method: 'POST' })
  .validator(experimentRefSchema)
  .handler(async ({ data }) =>
    experiments.stopExperiment(
      await projectActor(data.projectId, { experiment: ['update'] }),
      data,
    ),
  )

export const deleteExperiment = createServerFn({ method: 'POST' })
  .validator(experimentRefSchema)
  .handler(async ({ data }) =>
    experiments.deleteExperiment(
      await projectActor(data.projectId, { experiment: ['delete'] }),
      data,
    ),
  )
