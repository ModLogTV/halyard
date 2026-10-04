import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { apikey, environments, flags, member, organization, projects } from '@/db/schema'
import { auth } from '@/lib/auth'
import type { Permissions } from '@/lib/permissions'
import { conflict, forbidden, notFound } from '@/server/errors'
import { publish } from '@/server/events'
import {
  type CreateProjectInput,
  createProjectSchema,
  type UpdateProjectInput,
  updateProjectSchema,
} from '../schemas/projects'
import { recordAudit } from './audit'
import {
  assertProjectAccess,
  auditActor,
  type ProjectActorWithHeaders,
  type UserActorWithHeaders,
} from './authz'
import { authCall, isUniqueViolation, parseInput } from './util'

export type Environment = typeof environments.$inferSelect

export interface ProjectDetails {
  id: string
  name: string
  slug: string
  description: string | null
  staleAfterDays: number
  singleVariantAfterDays: number
  createdAt: Date
  environments: Environment[]
}

export interface ProjectListItem {
  id: string
  name: string
  slug: string
  description: string | null
  role: string
  environmentCount: number
  flagCount: number
}

export const DEFAULT_ENVIRONMENTS = [
  { key: 'development', name: 'Development', color: '#3b82f6', isProduction: false, sortOrder: 0 },
  { key: 'staging', name: 'Staging', color: '#f59e0b', isProduction: false, sortOrder: 1 },
  { key: 'production', name: 'Production', color: '#e11d48', isProduction: true, sortOrder: 2 },
] as const

async function loadProject(where: ReturnType<typeof eq>): Promise<ProjectDetails | null> {
  const [row] = await db
    .select({
      id: projects.id,
      name: organization.name,
      slug: organization.slug,
      description: projects.description,
      staleAfterDays: projects.staleAfterDays,
      singleVariantAfterDays: projects.singleVariantAfterDays,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .innerJoin(organization, eq(organization.id, projects.id))
    .where(where)
    .limit(1)
  if (!row) return null
  const envs = await db
    .select()
    .from(environments)
    .where(eq(environments.projectId, row.id))
    .orderBy(asc(environments.sortOrder), asc(environments.createdAt))
  return { ...row, environments: envs }
}

export async function getProjectById(id: string): Promise<ProjectDetails> {
  const project = await loadProject(eq(projects.id, id))
  if (!project) throw notFound('Project')
  return project
}

export async function getProjectBySlug(slug: string): Promise<ProjectDetails> {
  const project = await loadProject(eq(organization.slug, slug))
  if (!project) throw notFound('Project')
  return project
}

/** The projects a user is a member of, with their role and entity counts. */
export async function listProjectsForUser(userId: string): Promise<ProjectListItem[]> {
  return db
    .select({
      id: projects.id,
      name: organization.name,
      slug: organization.slug,
      description: projects.description,
      role: member.role,
      environmentCount: sql<number>`(select count(*)::int from ${environments} where ${environments.projectId} = ${projects.id})`,
      flagCount: sql<number>`(select count(*)::int from ${flags} where ${flags.projectId} = ${projects.id} and ${flags.archivedAt} is null)`,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .innerJoin(projects, eq(projects.id, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name))
}

/**
 * Resolves a project by slug and authorizes the current request against it.
 * Must be called from a server function; the session module (and with it TanStack)
 * is imported lazily so that the rest of this file stays free of HTTP concerns.
 */
export async function requireProjectBySlug(slug: string, permissions?: Permissions) {
  const project = await getProjectBySlug(slug)
  const { requireProjectPermission } = await import('@/server/auth/session')
  const actor = await requireProjectPermission(project.id, permissions)
  return { actor, project }
}

/**
 * Creates a project: the organization (the creator becomes its owner), the settings
 * row, and the default development, staging and production environments.
 */
export async function createProject(
  actor: UserActorWithHeaders,
  input: CreateProjectInput,
): Promise<ProjectDetails> {
  const data = parseInput(createProjectSchema, input)

  const taken = await db.query.organization.findFirst({
    where: eq(organization.slug, data.slug),
    columns: { id: true },
  })
  if (taken) throw conflict(`A project with the slug "${data.slug}" already exists`)

  const created = await authCall(() =>
    auth.api.createOrganization({
      headers: actor.headers,
      body: { name: data.name, slug: data.slug, keepCurrentActiveOrganization: true },
    }),
  )

  try {
    await db.transaction(async (tx) => {
      await tx.insert(projects).values({ id: created.id, description: data.description ?? null })
      await tx
        .insert(environments)
        .values(DEFAULT_ENVIRONMENTS.map((env) => ({ ...env, projectId: created.id })))
      await recordAudit(tx, {
        projectId: created.id,
        actor: auditActor(actor),
        action: 'project.created',
        entityType: 'project',
        entityId: created.id,
        entityKey: data.slug,
        after: { name: data.name, slug: data.slug, description: data.description ?? null },
      })
    })
  } catch (error) {
    // Do not leave a project-less organization behind.
    await db.delete(organization).where(eq(organization.id, created.id))
    if (isUniqueViolation(error))
      throw conflict(`A project with the slug "${data.slug}" already exists`)
    throw error
  }

  return getProjectById(created.id)
}

export async function updateProject(
  actor: ProjectActorWithHeaders,
  input: UpdateProjectInput,
): Promise<ProjectDetails> {
  const { projectId, patch } = parseInput(updateProjectSchema, input)
  assertProjectAccess(actor, projectId, { project: ['update'] })

  const before = await getProjectById(projectId)
  const pick = (p: ProjectDetails) => ({
    name: p.name,
    description: p.description,
    staleAfterDays: p.staleAfterDays,
    singleVariantAfterDays: p.singleVariantAfterDays,
  })

  if (patch.name !== undefined && patch.name !== before.name) {
    await authCall(() =>
      auth.api.updateOrganization({
        headers: actor.headers,
        body: { organizationId: projectId, data: { name: patch.name } },
      }),
    )
  }

  await db.transaction(async (tx) => {
    const settings: Partial<typeof projects.$inferInsert> = {}
    if (patch.description !== undefined) settings.description = patch.description
    if (patch.staleAfterDays !== undefined) settings.staleAfterDays = patch.staleAfterDays
    if (patch.singleVariantAfterDays !== undefined) {
      settings.singleVariantAfterDays = patch.singleVariantAfterDays
    }
    if (Object.keys(settings).length > 0) {
      await tx.update(projects).set(settings).where(eq(projects.id, projectId))
    }
    const after = await tx
      .select({
        description: projects.description,
        staleAfterDays: projects.staleAfterDays,
        singleVariantAfterDays: projects.singleVariantAfterDays,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'project.updated',
      entityType: 'project',
      entityId: projectId,
      entityKey: before.slug,
      before: pick(before),
      after: { name: patch.name ?? before.name, ...after[0] },
    })
  })

  return getProjectById(projectId)
}

/**
 * Deletes a project and everything in it. Only owners may do this. The audit trail
 * belongs to the project and is removed with it.
 */
export async function deleteProject(
  actor: ProjectActorWithHeaders,
  input: { projectId: string },
): Promise<{ id: string }> {
  assertProjectAccess(actor, input.projectId, { project: ['delete'] })
  if (actor.role !== 'owner') throw forbidden('Only project owners can delete a project')
  await getProjectById(input.projectId)

  await authCall(() =>
    auth.api.deleteOrganization({
      headers: actor.headers,
      body: { organizationId: input.projectId },
    }),
  )
  // API keys reference the organization without a foreign key.
  await db.delete(apikey).where(eq(apikey.referenceId, input.projectId))
  await publish({ type: 'ruleset.invalidate', projectId: input.projectId }, db)
  await publish({ type: 'apikey.invalidate' }, db)
  return { id: input.projectId }
}
