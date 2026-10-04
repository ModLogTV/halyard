import { auth } from '@/lib/auth'
import type { ProjectRole } from '@/lib/permissions'
import type { ProjectActorWithHeaders, UserActorWithHeaders } from '@/server/services/authz'
import { createProject, type ProjectDetails } from '@/server/services/projects'
import { createTestUser, type TestUser } from './helpers'

export interface TestMember {
  user: TestUser
  name: string
  actor: ProjectActorWithHeaders
}

export function userActorFor(user: TestUser, name: string): UserActorWithHeaders {
  return { userId: user.id, name, email: user.email, isAdmin: false, headers: user.headers }
}

export function projectActorFor(
  user: TestUser,
  name: string,
  projectId: string,
  role: ProjectRole,
): ProjectActorWithHeaders {
  return { ...userActorFor(user, name), projectId, role }
}

export interface ProjectFixture {
  project: ProjectDetails
  projectId: string
  owner: TestMember
  editor: TestMember
  viewer: TestMember
  /** A signed-in user who is not a member of the project. */
  outsider: TestUser
  environmentId: (key: string) => string
}

/** Creates a project with an owner, an editor and a viewer, plus an unrelated user. */
export async function createProjectFixture(slug = 'acme'): Promise<ProjectFixture> {
  const ownerUser = await createTestUser({ name: 'Olivia Owner' })
  const project = await createProject(userActorFor(ownerUser, 'Olivia Owner'), {
    name: 'Acme',
    slug,
  })

  const addMember = async (name: string, role: ProjectRole): Promise<TestMember> => {
    const user = await createTestUser({ name })
    await auth.api.addMember({ body: { organizationId: project.id, userId: user.id, role } })
    return { user, name, actor: projectActorFor(user, name, project.id, role) }
  }

  return {
    project,
    projectId: project.id,
    owner: {
      user: ownerUser,
      name: 'Olivia Owner',
      actor: projectActorFor(ownerUser, 'Olivia Owner', project.id, 'owner'),
    },
    editor: await addMember('Eddie Editor', 'editor'),
    viewer: await addMember('Vera Viewer', 'viewer'),
    outsider: await createTestUser({ name: 'Otto Outsider' }),
    environmentId: (key) => {
      const env = project.environments.find((e) => e.key === key)
      if (!env) throw new Error(`No environment ${key}`)
      return env.id
    },
  }
}

import { type HalyardEvent, subscribe } from '@/server/events'

/** Records events published through `publish` until `stop` is called. */
export function captureEvents() {
  const events: HalyardEvent[] = []
  const stop = subscribe((event) => events.push(event))
  return { events, stop, clear: () => events.splice(0, events.length) }
}
