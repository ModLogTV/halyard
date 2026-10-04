import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { apikey, environments, flagEnvironments, flags } from '@/db/schema'
import { badRequest, conflict, notFound } from '@/server/errors'
import { publish } from '@/server/events'
import {
  type CreateEnvironmentInput,
  createEnvironmentSchema,
  deleteEnvironmentSchema,
  listEnvironmentsSchema,
  reorderEnvironmentsSchema,
  type UpdateEnvironmentInput,
  updateEnvironmentSchema,
} from '../schemas/environments'
import { recordAudit } from './audit'
import { assertProjectAccess, auditActor, type ProjectActor, persistedUserId } from './authz'
import { defaultEnvironmentConfig } from './flag-config'
import type { Environment } from './projects'
import { isUniqueViolation, one, parseInput } from './util'

export type { Environment }

const DEFAULT_COLOR = '#64748b'

const snapshot = (env: Environment) => ({
  key: env.key,
  name: env.name,
  color: env.color,
  isProduction: env.isProduction,
  sortOrder: env.sortOrder,
})

export async function listEnvironments(
  actor: ProjectActor,
  input: { projectId: string },
): Promise<Environment[]> {
  const { projectId } = parseInput(listEnvironmentsSchema, input)
  assertProjectAccess(actor, projectId, { environment: ['read'] })
  return db
    .select()
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(asc(environments.sortOrder), asc(environments.createdAt))
}

/**
 * Creates an environment and a disabled configuration for every existing flag
 * (archived ones included, so they are complete when unarchived).
 */
export async function createEnvironment(
  actor: ProjectActor,
  input: CreateEnvironmentInput,
): Promise<Environment> {
  const data = parseInput(createEnvironmentSchema, input)
  assertProjectAccess(actor, data.projectId, { environment: ['create'] })

  try {
    return await db.transaction(async (tx) => {
      const { next } = one(
        await tx
          .select({ next: sql<number>`coalesce(max(${environments.sortOrder}), -1) + 1` })
          .from(environments)
          .where(eq(environments.projectId, data.projectId)),
      )

      const created = one(
        await tx
          .insert(environments)
          .values({
            projectId: data.projectId,
            key: data.key,
            name: data.name,
            color: data.color ?? DEFAULT_COLOR,
            isProduction: data.isProduction ?? false,
            sortOrder: next,
          })
          .returning(),
      )

      const projectFlags = await tx.select().from(flags).where(eq(flags.projectId, data.projectId))
      if (projectFlags.length > 0) {
        await tx.insert(flagEnvironments).values(
          projectFlags.map((flag) => ({
            flagId: flag.id,
            environmentId: created.id,
            updatedBy: persistedUserId(actor),
            ...defaultEnvironmentConfig(flag),
          })),
        )
      }

      await recordAudit(tx, {
        projectId: data.projectId,
        environmentId: created.id,
        actor: auditActor(actor),
        action: 'environment.created',
        entityType: 'environment',
        entityId: created.id,
        entityKey: created.key,
        after: snapshot(created),
      })
      await publish({ type: 'ruleset.invalidate', projectId: data.projectId }, tx)
      return created
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(`An environment with the key "${data.key}" already exists`)
    }
    throw error
  }
}

/** Updates name, color and the production flag. The key is immutable because SDKs and URLs refer to it. */
export async function updateEnvironment(
  actor: ProjectActor,
  input: UpdateEnvironmentInput,
): Promise<Environment> {
  const { projectId, environmentId, patch } = parseInput(updateEnvironmentSchema, input)
  assertProjectAccess(actor, projectId, { environment: ['update'] })

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(environments)
      .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
      .for('update')
    if (!before) throw notFound('Environment')

    const updated = one(
      await tx
        .update(environments)
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.color !== undefined && { color: patch.color }),
          ...(patch.isProduction !== undefined && { isProduction: patch.isProduction }),
        })
        .where(eq(environments.id, environmentId))
        .returning(),
    )

    await recordAudit(tx, {
      projectId,
      environmentId,
      actor: auditActor(actor),
      action: 'environment.updated',
      entityType: 'environment',
      entityId: environmentId,
      entityKey: before.key,
      before: snapshot(before),
      after: snapshot(updated),
    })
    await publish({ type: 'ruleset.invalidate', projectId, environmentId }, tx)
    return updated
  })
}

/** Deletes an environment with its flag configurations and SDK keys. The last environment cannot be deleted. */
export async function deleteEnvironment(
  actor: ProjectActor,
  input: { projectId: string; environmentId: string },
): Promise<{ id: string }> {
  const { projectId, environmentId } = parseInput(deleteEnvironmentSchema, input)
  assertProjectAccess(actor, projectId, { environment: ['delete'] })

  let revokedKeys = false
  await db.transaction(async (tx) => {
    const all = await tx
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .for('update')
    const target = all.find((env) => env.id === environmentId)
    if (!target) throw notFound('Environment')
    if (all.length <= 1) throw badRequest('A project must keep at least one environment')

    // SDK keys are bound to one environment and stop being useful once it is gone.
    const sdkKeys = await tx
      .select({ id: apikey.id, metadata: apikey.metadata })
      .from(apikey)
      .where(and(eq(apikey.referenceId, projectId), eq(apikey.configId, 'sdk')))
    const doomed = sdkKeys.filter(
      (key) => parseMetadata(key.metadata).environmentId === environmentId,
    )
    for (const key of doomed) await tx.delete(apikey).where(eq(apikey.id, key.id))
    revokedKeys = doomed.length > 0

    await tx.delete(environments).where(eq(environments.id, environmentId))
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'environment.deleted',
      entityType: 'environment',
      entityId: environmentId,
      entityKey: target.key,
      before: snapshot(target),
    })
    await publish({ type: 'ruleset.invalidate', projectId, environmentId }, tx)
    if (revokedKeys) await publish({ type: 'apikey.invalidate' }, tx)
  })
  return { id: environmentId }
}

/** Sets the display order. `environmentIds` must list every environment of the project exactly once. */
export async function reorderEnvironments(
  actor: ProjectActor,
  input: { projectId: string; environmentIds: string[] },
): Promise<Environment[]> {
  const { projectId, environmentIds } = parseInput(reorderEnvironmentsSchema, input)
  assertProjectAccess(actor, projectId, { environment: ['update'] })

  await db.transaction(async (tx) => {
    const all = await tx
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .for('update')
    const known = new Set(all.map((env) => env.id))
    if (
      new Set(environmentIds).size !== environmentIds.length ||
      environmentIds.length !== known.size ||
      environmentIds.some((id) => !known.has(id))
    ) {
      throw badRequest('The order must list every environment of the project exactly once')
    }
    for (const [index, id] of environmentIds.entries()) {
      const current = all.find((env) => env.id === id)
      if (!current || current.sortOrder === index) continue
      await tx.update(environments).set({ sortOrder: index }).where(eq(environments.id, id))
      await recordAudit(tx, {
        projectId,
        environmentId: id,
        actor: auditActor(actor),
        action: 'environment.updated',
        entityType: 'environment',
        entityId: id,
        entityKey: current.key,
        before: { sortOrder: current.sortOrder },
        after: { sortOrder: index },
      })
    }
  })

  return listEnvironments(actor, { projectId })
}

/** API key metadata is stored as a JSON string, occasionally double-encoded by older plugin versions. */
function parseMetadata(raw: string | null): { environmentId?: string } {
  let value: unknown = raw
  for (let i = 0; i < 2 && typeof value === 'string'; i += 1) {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as { environmentId?: string }) : {}
}
