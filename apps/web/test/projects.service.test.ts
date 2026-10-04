import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, environments, member, organization, projects } from '@/db/schema'
import { auth } from '@/lib/auth'
import {
  createProject,
  deleteProject,
  getProjectById,
  getProjectBySlug,
  listProjectsForUser,
  updateProject,
} from '@/server/services/projects'
import { createProjectFixture, userActorFor } from './factories'
import { createTestUser, resetDatabase } from './helpers'

beforeEach(resetDatabase)

describe('createProject', () => {
  it('creates the organization, settings row and default environments', async () => {
    const user = await createTestUser({ name: 'Ada' })
    const project = await createProject(userActorFor(user, 'Ada'), {
      name: 'Acme',
      slug: 'acme',
      description: 'Flags for Acme',
    })

    expect(project).toMatchObject({
      name: 'Acme',
      slug: 'acme',
      description: 'Flags for Acme',
      staleAfterDays: 30,
      singleVariantAfterDays: 30,
    })
    expect(project.environments.map((e) => [e.key, e.color, e.isProduction, e.sortOrder])).toEqual([
      ['development', '#3b82f6', false, 0],
      ['staging', '#f59e0b', false, 1],
      ['production', '#e11d48', true, 2],
    ])

    const [membership] = await db.select().from(member).where(eq(member.organizationId, project.id))
    expect(membership).toMatchObject({ userId: user.id, role: 'owner' })

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.projectId, project.id))
    expect(audit).toMatchObject({
      action: 'project.created',
      actorType: 'user',
      actorId: user.id,
      actorName: 'Ada',
      entityKey: 'acme',
    })
  })

  it('rejects an invalid slug with a 400', async () => {
    const user = await createTestUser()
    for (const slug of ['Acme', '-acme', 'acme-', 'a b', '']) {
      await expect(
        createProject(userActorFor(user, 'U'), { name: 'Acme', slug }),
      ).rejects.toMatchObject({ status: 400 })
    }
  })

  it('answers 409 for a slug that is taken and leaves no stray rows', async () => {
    const user = await createTestUser()
    await createProject(userActorFor(user, 'U'), { name: 'One', slug: 'taken' })
    await expect(
      createProject(userActorFor(user, 'U'), { name: 'Two', slug: 'taken' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(await db.select().from(organization)).toHaveLength(1)
    expect(await db.select().from(projects)).toHaveLength(1)
  })

  it('requires a signed-in user', async () => {
    await expect(
      createProject(
        { userId: 'x', name: 'x', email: 'x@example.com', isAdmin: false, headers: new Headers() },
        { name: 'Acme', slug: 'acme' },
      ),
    ).rejects.toMatchObject({ status: 401 })
  })
})

describe('reading projects', () => {
  it('lists only the projects a user belongs to, with role and counts', async () => {
    const fx = await createProjectFixture('acme')
    const other = await createProjectFixture('other')

    const owned = await listProjectsForUser(fx.owner.user.id)
    expect(owned).toEqual([
      expect.objectContaining({
        id: fx.projectId,
        slug: 'acme',
        name: 'Acme',
        role: 'owner',
        environmentCount: 3,
        flagCount: 0,
      }),
    ])
    expect((await listProjectsForUser(fx.viewer.user.id))[0]?.role).toBe('viewer')
    expect(await listProjectsForUser(fx.outsider.id)).toEqual([])
    expect((await listProjectsForUser(other.owner.user.id)).map((p) => p.slug)).toEqual(['other'])
  })

  it('resolves a project by slug and id and 404s for unknown ones', async () => {
    const fx = await createProjectFixture('acme')
    expect((await getProjectBySlug('acme')).id).toBe(fx.projectId)
    expect((await getProjectById(fx.projectId)).environments).toHaveLength(3)
    await expect(getProjectBySlug('nope')).rejects.toMatchObject({ status: 404 })
    await expect(getProjectById('nope')).rejects.toMatchObject({ status: 404 })
  })
})

describe('updateProject', () => {
  it('updates name through the organization plugin and settings, with an audit entry', async () => {
    const fx = await createProjectFixture()
    const updated = await updateProject(fx.owner.actor, {
      projectId: fx.projectId,
      patch: { name: 'Acme Corp', description: 'New', staleAfterDays: 60 },
    })
    expect(updated).toMatchObject({ name: 'Acme Corp', description: 'New', staleAfterDays: 60 })
    const org = await db.query.organization.findFirst({ where: eq(organization.id, fx.projectId) })
    expect(org?.name).toBe('Acme Corp')

    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'project.updated'))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.before).toMatchObject({ name: 'Acme', staleAfterDays: 30 })
    expect(entries[0]?.after).toMatchObject({ name: 'Acme Corp', staleAfterDays: 60 })
  })

  it('is limited to owners', async () => {
    const fx = await createProjectFixture()
    for (const who of [fx.editor, fx.viewer]) {
      await expect(
        updateProject(who.actor, { projectId: fx.projectId, patch: { name: 'Hacked' } }),
      ).rejects.toMatchObject({ status: 403 })
    }
  })

  it('rejects an actor authorized for a different project', async () => {
    const fx = await createProjectFixture('acme')
    const other = await createProjectFixture('other')
    await expect(
      updateProject(other.owner.actor, { projectId: fx.projectId, patch: { name: 'x' } }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('deleteProject', () => {
  it('lets the owner delete the project and cascades its data', async () => {
    const fx = await createProjectFixture()
    await deleteProject(fx.owner.actor, { projectId: fx.projectId })
    expect(await db.select().from(projects)).toHaveLength(0)
    expect(await db.select().from(environments)).toHaveLength(0)
    expect(await db.select().from(organization)).toHaveLength(0)
  })

  it('refuses editors and viewers', async () => {
    const fx = await createProjectFixture()
    await expect(deleteProject(fx.editor.actor, { projectId: fx.projectId })).rejects.toMatchObject(
      {
        status: 403,
      },
    )
    await expect(deleteProject(fx.viewer.actor, { projectId: fx.projectId })).rejects.toMatchObject(
      {
        status: 403,
      },
    )
    expect(await getProjectById(fx.projectId)).toBeDefined()
  })

  it('does not honour a forged owner role without real membership', async () => {
    const fx = await createProjectFixture()
    const forged = { ...fx.editor.actor, role: 'owner' as const }
    await expect(deleteProject(forged, { projectId: fx.projectId })).rejects.toMatchObject({
      status: 403,
    })
    expect(
      await auth.api.getFullOrganization({
        headers: fx.owner.user.headers,
        query: { organizationId: fx.projectId },
      }),
    ).toBeTruthy()
  })
})
