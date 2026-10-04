import { createServerFn } from '@tanstack/react-start'
import { projectActor, userActor } from '@/server/request-actor'
import {
  createProjectSchema,
  deleteProjectSchema,
  getProjectSchema,
  updateProjectSchema,
} from '@/server/schemas/projects'
import * as projects from '@/server/services/projects'

/** Projects the signed-in user belongs to, with role and counts. */
export const listProjects = createServerFn({ method: 'GET' }).handler(async () => {
  const actor = await userActor()
  return projects.listProjectsForUser(actor.userId)
})

export const createProject = createServerFn({ method: 'POST' })
  .inputValidator(createProjectSchema)
  .handler(async ({ data }) => projects.createProject(await userActor(), data))

/** A project with its environments and the caller's role in it. */
export const getProject = createServerFn({ method: 'GET' })
  .inputValidator(getProjectSchema)
  .handler(async ({ data }) => {
    const { actor, project } = await projects.requireProjectBySlug(data.slug, { project: ['read'] })
    return { ...project, role: actor.role }
  })

export const updateProject = createServerFn({ method: 'POST' })
  .inputValidator(updateProjectSchema)
  .handler(async ({ data }) =>
    projects.updateProject(await projectActor(data.projectId, { project: ['update'] }), data),
  )

export const deleteProject = createServerFn({ method: 'POST' })
  .inputValidator(deleteProjectSchema)
  .handler(async ({ data }) =>
    projects.deleteProject(await projectActor(data.projectId, { project: ['delete'] }), data),
  )
