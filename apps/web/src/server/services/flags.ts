import {
  type FlagDefinition,
  type Serve,
  type Variant,
  validateEnvironmentConfig,
  validateFlagDefinition,
} from '@halyard/engine'
import { and, arrayOverlaps, asc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { db, type Transaction } from '@/db'
import {
  environments,
  experiments,
  flagEnvironments,
  flagEvaluationStats,
  flags,
  segments,
} from '@/db/schema'
import type { Permissions } from '@/lib/permissions'
import { badRequest, conflict, notFound } from '@/server/errors'
import { publish } from '@/server/events'
import {
  type CopyFlagEnvironmentInput,
  type CreateFlagInput,
  copyFlagEnvironmentSchema,
  createFlagSchema,
  flagRefSchema,
  type ListFlagsInput,
  listFlagsSchema,
  toggleFlagSchema,
  type UpdateFlagEnvironmentInput,
  type UpdateFlagInput,
  updateFlagEnvironmentSchema,
  updateFlagSchema,
} from '../schemas/flags'
import { recordAudit } from './audit'
import { assertProjectAccess, auditActor, type ProjectActor, persistedUserId } from './authz'
import {
  defaultEnvironmentConfig,
  defaultVariantsFor,
  findVariantReferences,
  type StoredEnvironmentConfig,
  toStoredConfig,
  withRuleIds,
} from './flag-config'
import { isUniqueViolation, jsonEqual, one, parseInput } from './util'

export type Flag = typeof flags.$inferSelect

export interface FlagEnvironmentSummary {
  environmentId: string
  environmentKey: string
  enabled: boolean
  fallthrough: Serve
  ruleCount: number
  version: number
  updatedAt: Date
}

export interface FlagStatsEntry {
  environmentId: string
  lastEvaluatedAt: Date
  lastVariant: string | null
  sameVariantSince: Date
  evaluationCount: number
}

export interface FlagListItem extends Flag {
  environments: FlagEnvironmentSummary[]
  stats: FlagStatsEntry[]
}

export interface FlagEnvironmentDetail extends StoredEnvironmentConfig {
  environmentId: string
  environmentKey: string
  version: number
  updatedAt: Date
  updatedBy: string | null
  hasRunningExperiment: boolean
}

export interface FlagDetail extends Flag {
  environments: FlagEnvironmentDetail[]
  stats: FlagStatsEntry[]
}

const definitionOf = (flag: Pick<Flag, 'key' | 'type' | 'variants'>): FlagDefinition => ({
  key: flag.key,
  type: flag.type,
  variants: flag.variants,
})

const flagSnapshot = (flag: Flag) => ({
  key: flag.key,
  name: flag.name,
  description: flag.description,
  type: flag.type,
  variants: flag.variants,
  tags: flag.tags,
  archived: flag.archivedAt !== null,
})

const uniqueTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim()).filter(Boolean))]

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

function problems(list: string[]): never {
  throw badRequest(list.join('; '))
}

async function findFlag(
  tx: Transaction | typeof db,
  projectId: string,
  flagKey: string,
  lock = false,
) {
  const query = tx
    .select()
    .from(flags)
    .where(and(eq(flags.projectId, projectId), eq(flags.key, flagKey)))
  const [flag] = lock ? await query.for('update') : await query
  if (!flag) throw notFound('Flag')
  return flag
}

async function findEnvironment(
  tx: Transaction | typeof db,
  projectId: string,
  environmentKey: string,
) {
  const [env] = await tx
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.key, environmentKey)))
  if (!env) throw notFound('Environment')
  return env
}

async function projectSegmentKeys(tx: Transaction | typeof db, projectId: string) {
  const rows = await tx
    .select({ key: segments.key })
    .from(segments)
    .where(eq(segments.projectId, projectId))
  return rows.map((r) => r.key)
}

async function statsFor(flagIds: string[]): Promise<Map<string, FlagStatsEntry[]>> {
  const byFlag = new Map<string, FlagStatsEntry[]>()
  if (flagIds.length === 0) return byFlag
  const rows = await db
    .select()
    .from(flagEvaluationStats)
    .where(inArray(flagEvaluationStats.flagId, flagIds))
  for (const row of rows) {
    const list = byFlag.get(row.flagId) ?? []
    list.push({
      environmentId: row.environmentId,
      lastEvaluatedAt: row.lastEvaluatedAt,
      lastVariant: row.lastVariant,
      sameVariantSince: row.sameVariantSince,
      evaluationCount: row.evaluationCount,
    })
    byFlag.set(row.flagId, list)
  }
  return byFlag
}

/**
 * Creates a flag together with a disabled configuration in every environment of the
 * project. Boolean flags default to `on` / `off` variants.
 */
export async function createFlag(actor: ProjectActor, input: CreateFlagInput): Promise<Flag> {
  const data = parseInput(createFlagSchema, input)
  assertProjectAccess(actor, data.projectId, { flag: ['create'] })

  const variants: Variant[] | undefined = data.variants ?? defaultVariantsFor(data.type)
  if (!variants || variants.length === 0) throw badRequest('Flag must have at least one variant')

  const definition: FlagDefinition = { key: data.key, type: data.type, variants }
  const definitionProblems = validateFlagDefinition(definition)
  if (definitionProblems.length > 0) problems(definitionProblems)

  const scheme = defaultEnvironmentConfig(definition, {
    offVariant: data.offVariant,
    defaultVariant: data.defaultVariant,
  })

  try {
    return await db.transaction(async (tx) => {
      const flag = one(
        await tx
          .insert(flags)
          .values({
            projectId: data.projectId,
            key: data.key,
            name: data.name,
            description: data.description ?? null,
            type: data.type,
            variants,
            tags: uniqueTags(data.tags ?? []),
            createdBy: persistedUserId(actor),
          })
          .returning(),
      )

      const envs = await tx
        .select()
        .from(environments)
        .where(eq(environments.projectId, data.projectId))
      if (envs.length > 0) {
        await tx.insert(flagEnvironments).values(
          envs.map((env) => ({
            flagId: flag.id,
            environmentId: env.id,
            updatedBy: persistedUserId(actor),
            ...scheme,
          })),
        )
      }

      await recordAudit(tx, {
        projectId: data.projectId,
        actor: auditActor(actor),
        action: 'flag.created',
        entityType: 'flag',
        entityId: flag.id,
        entityKey: flag.key,
        after: { ...flagSnapshot(flag), defaultConfig: scheme },
      })
      await publish({ type: 'ruleset.invalidate', projectId: data.projectId }, tx)
      return flag
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`A flag with the key "${data.key}" already exists`)
    throw error
  }
}

export async function listFlags(
  actor: ProjectActor,
  input: ListFlagsInput,
): Promise<FlagListItem[]> {
  const query = parseInput(listFlagsSchema, input)
  assertProjectAccess(actor, query.projectId, { flag: ['read'] })

  const conditions: (SQL | undefined)[] = [eq(flags.projectId, query.projectId)]
  if (!query.includeArchived) conditions.push(isNull(flags.archivedAt))
  if (query.type) conditions.push(eq(flags.type, query.type))
  if (query.tags && query.tags.length > 0) conditions.push(arrayOverlaps(flags.tags, query.tags))
  const search = query.search?.trim()
  if (search) {
    const pattern = `%${escapeLike(search)}%`
    conditions.push(or(ilike(flags.key, pattern), ilike(flags.name, pattern)))
  }

  const rows = await db
    .select()
    .from(flags)
    .where(and(...conditions))
    .orderBy(asc(flags.key))
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const configs = await db
    .select({
      flagId: flagEnvironments.flagId,
      environmentId: flagEnvironments.environmentId,
      environmentKey: environments.key,
      enabled: flagEnvironments.enabled,
      fallthrough: flagEnvironments.fallthrough,
      ruleCount: sql<number>`jsonb_array_length(${flagEnvironments.rules})`,
      version: flagEnvironments.version,
      updatedAt: flagEnvironments.updatedAt,
    })
    .from(flagEnvironments)
    .innerJoin(environments, eq(environments.id, flagEnvironments.environmentId))
    .where(inArray(flagEnvironments.flagId, ids))
    .orderBy(asc(environments.sortOrder), asc(environments.createdAt))
  const stats = await statsFor(ids)

  return rows.map((flag) => ({
    ...flag,
    environments: configs
      .filter((c) => c.flagId === flag.id)
      .map(({ flagId: _flagId, ...config }) => config),
    stats: stats.get(flag.id) ?? [],
  }))
}

export async function getFlag(
  actor: ProjectActor,
  input: { projectId: string; flagKey: string },
): Promise<FlagDetail> {
  const { projectId, flagKey } = parseInput(flagRefSchema, input)
  assertProjectAccess(actor, projectId, { flag: ['read'] })

  const flag = await findFlag(db, projectId, flagKey)
  const configs = await db
    .select({
      environmentId: flagEnvironments.environmentId,
      environmentKey: environments.key,
      enabled: flagEnvironments.enabled,
      offVariant: flagEnvironments.offVariant,
      fallthrough: flagEnvironments.fallthrough,
      rules: flagEnvironments.rules,
      version: flagEnvironments.version,
      updatedAt: flagEnvironments.updatedAt,
      updatedBy: flagEnvironments.updatedBy,
    })
    .from(flagEnvironments)
    .innerJoin(environments, eq(environments.id, flagEnvironments.environmentId))
    .where(eq(flagEnvironments.flagId, flag.id))
    .orderBy(asc(environments.sortOrder), asc(environments.createdAt))
  const running = await db
    .select({ environmentId: experiments.environmentId })
    .from(experiments)
    .where(and(eq(experiments.flagId, flag.id), eq(experiments.status, 'running')))
  const runningEnvs = new Set(running.map((r) => r.environmentId))
  const stats = await statsFor([flag.id])

  return {
    ...flag,
    environments: configs.map((c) => ({
      ...c,
      hasRunningExperiment: runningEnvs.has(c.environmentId),
    })),
    stats: stats.get(flag.id) ?? [],
  }
}

/**
 * Updates name, description, tags and variants. A variant that is removed (or whose key
 * is renamed) must not be referenced by any environment configuration or running
 * experiment.
 */
export async function updateFlag(actor: ProjectActor, input: UpdateFlagInput): Promise<Flag> {
  const { projectId, flagKey, patch } = parseInput(updateFlagSchema, input)
  assertProjectAccess(actor, projectId, { flag: ['update'] })

  return db.transaction(async (tx) => {
    const before = await findFlag(tx, projectId, flagKey, true)

    const next = {
      name: patch.name ?? before.name,
      description: patch.description === undefined ? before.description : patch.description,
      tags: patch.tags ? uniqueTags(patch.tags) : before.tags,
      variants: (patch.variants as Variant[] | undefined) ?? before.variants,
    }

    if (patch.variants) {
      const definitionProblems = validateFlagDefinition({
        key: before.key,
        type: before.type,
        variants: next.variants,
      })
      if (definitionProblems.length > 0) problems(definitionProblems)

      const kept = new Set(next.variants.map((v) => v.key))
      const removed = before.variants.map((v) => v.key).filter((key) => !kept.has(key))
      if (removed.length > 0) await assertVariantsUnused(tx, before.id, removed)
    }

    if (
      next.name === before.name &&
      next.description === before.description &&
      jsonEqual(next.tags, before.tags) &&
      jsonEqual(next.variants, before.variants)
    ) {
      return before
    }

    const after = one(await tx.update(flags).set(next).where(eq(flags.id, before.id)).returning())
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'flag.updated',
      entityType: 'flag',
      entityId: after.id,
      entityKey: after.key,
      before: flagSnapshot(before),
      after: flagSnapshot(after),
    })
    await publish({ type: 'ruleset.invalidate', projectId }, tx)
    return after
  })
}

async function assertVariantsUnused(tx: Transaction, flagId: string, removed: string[]) {
  const configs = await tx
    .select({ config: flagEnvironments, environmentKey: environments.key })
    .from(flagEnvironments)
    .innerJoin(environments, eq(environments.id, flagEnvironments.environmentId))
    .where(eq(flagEnvironments.flagId, flagId))
  const running = await tx
    .select({
      key: experiments.key,
      allocation: experiments.allocation,
      controlVariant: experiments.controlVariant,
    })
    .from(experiments)
    .where(and(eq(experiments.flagId, flagId), eq(experiments.status, 'running')))

  const messages: string[] = []
  for (const variantKey of removed) {
    for (const { config, environmentKey } of configs) {
      for (const ref of findVariantReferences(toStoredConfig(config), variantKey)) {
        messages.push(`"${variantKey}" is used by ${ref.where} in ${environmentKey}`)
      }
    }
    for (const experiment of running) {
      const used =
        experiment.controlVariant === variantKey ||
        experiment.allocation.some((v) => v.variant === variantKey)
      if (used)
        messages.push(`"${variantKey}" is used by the running experiment "${experiment.key}"`)
    }
  }
  if (messages.length > 0) {
    throw badRequest(
      `Cannot remove or rename variants that are still in use: ${messages.join('; ')}`,
    )
  }
}

async function setArchived(
  actor: ProjectActor,
  input: { projectId: string; flagKey: string },
  archived: boolean,
): Promise<Flag> {
  const { projectId, flagKey } = parseInput(flagRefSchema, input)
  assertProjectAccess(actor, projectId, { flag: ['update'] })

  return db.transaction(async (tx) => {
    const before = await findFlag(tx, projectId, flagKey, true)
    if ((before.archivedAt !== null) === archived) return before
    const after = one(
      await tx
        .update(flags)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(flags.id, before.id))
        .returning(),
    )
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: archived ? 'flag.archived' : 'flag.unarchived',
      entityType: 'flag',
      entityId: after.id,
      entityKey: after.key,
      before: flagSnapshot(before),
      after: flagSnapshot(after),
    })
    // Archived flags are left out of rulesets.
    await publish({ type: 'ruleset.invalidate', projectId }, tx)
    return after
  })
}

export const archiveFlag = (actor: ProjectActor, input: { projectId: string; flagKey: string }) =>
  setArchived(actor, input, true)

export const unarchiveFlag = (actor: ProjectActor, input: { projectId: string; flagKey: string }) =>
  setArchived(actor, input, false)

export async function deleteFlag(
  actor: ProjectActor,
  input: { projectId: string; flagKey: string },
): Promise<{ id: string; key: string }> {
  const { projectId, flagKey } = parseInput(flagRefSchema, input)
  assertProjectAccess(actor, projectId, { flag: ['delete'] })

  return db.transaction(async (tx) => {
    const flag = await findFlag(tx, projectId, flagKey, true)
    await tx.delete(flags).where(eq(flags.id, flag.id))
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'flag.deleted',
      entityType: 'flag',
      entityId: flag.id,
      entityKey: flag.key,
      before: flagSnapshot(flag),
    })
    await publish({ type: 'ruleset.invalidate', projectId }, tx)
    return { id: flag.id, key: flag.key }
  })
}

/** Toggling needs `flag:toggle`; every other change needs `flag:update`. */
export function permissionsForEnvironmentPatch(
  patch: UpdateFlagEnvironmentInput['patch'],
): Permissions {
  const changed = Object.entries(patch).filter(([, value]) => value !== undefined)
  return changed.length === 1 && changed[0]?.[0] === 'enabled'
    ? { flag: ['toggle'] }
    : { flag: ['update'] }
}

export interface FlagEnvironmentResult extends StoredEnvironmentConfig {
  flagKey: string
  environmentId: string
  environmentKey: string
  version: number
  updatedAt: Date
}

async function loadConfigForUpdate(
  tx: Transaction,
  projectId: string,
  flagKey: string,
  environmentKey: string,
) {
  const flag = await findFlag(tx, projectId, flagKey)
  const env = await findEnvironment(tx, projectId, environmentKey)
  const [row] = await tx
    .select()
    .from(flagEnvironments)
    .where(and(eq(flagEnvironments.flagId, flag.id), eq(flagEnvironments.environmentId, env.id)))
    .for('update')
  if (!row) throw notFound('Flag configuration')
  return { flag, env, row }
}

function toResult(
  flagKey: string,
  environmentKey: string,
  row: typeof flagEnvironments.$inferSelect,
) {
  return {
    flagKey,
    environmentId: row.environmentId,
    environmentKey,
    ...toStoredConfig(row),
    version: row.version,
    updatedAt: row.updatedAt,
  } satisfies FlagEnvironmentResult
}

/**
 * Merges `patch` over the current configuration of a flag in one environment.
 * Fails with 409 when `expectedVersion` is stale. Changes that leave the
 * configuration untouched are not written and do not bump the version.
 */
export async function updateFlagEnvironment(
  actor: ProjectActor,
  input: UpdateFlagEnvironmentInput,
): Promise<FlagEnvironmentResult> {
  const { projectId, flagKey, environmentKey, patch, expectedVersion } = parseInput(
    updateFlagEnvironmentSchema,
    input,
  )
  if (Object.values(patch).every((value) => value === undefined)) {
    throw badRequest('Provide at least one field to change')
  }
  assertProjectAccess(actor, projectId, permissionsForEnvironmentPatch(patch))
  const onlyEnabled = Object.entries(patch).every(([k, v]) => k === 'enabled' || v === undefined)

  return db.transaction(async (tx) => {
    const { flag, env, row } = await loadConfigForUpdate(tx, projectId, flagKey, environmentKey)
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      throw conflict(
        `This configuration was changed by someone else (version ${row.version}, expected ${expectedVersion}). Reload and try again`,
      )
    }

    const before = toStoredConfig(row)
    const merged: StoredEnvironmentConfig = {
      enabled: patch.enabled ?? before.enabled,
      offVariant: patch.offVariant ?? before.offVariant,
      fallthrough: patch.fallthrough ?? before.fallthrough,
      rules: patch.rules ? withRuleIds(patch.rules) : before.rules,
    }

    const configProblems = validateEnvironmentConfig(
      definitionOf(flag),
      merged,
      await projectSegmentKeys(tx, projectId),
    )
    if (configProblems.length > 0) problems(configProblems)

    if (jsonEqual(before, merged)) return toResult(flag.key, env.key, row)

    const updated = one(
      await tx
        .update(flagEnvironments)
        .set({ ...merged, version: row.version + 1, updatedBy: persistedUserId(actor) })
        .where(eq(flagEnvironments.id, row.id))
        .returning(),
    )

    await recordAudit(tx, {
      projectId,
      environmentId: env.id,
      actor: auditActor(actor),
      action: onlyEnabled ? 'flag.toggled' : 'flag.environment_updated',
      entityType: 'flag',
      entityId: flag.id,
      entityKey: flag.key,
      before,
      after: toStoredConfig(updated),
    })
    await publish({ type: 'ruleset.invalidate', projectId, environmentId: env.id }, tx)
    return toResult(flag.key, env.key, updated)
  })
}

export function toggleFlag(
  actor: ProjectActor,
  input: {
    projectId: string
    flagKey: string
    environmentKey: string
    enabled: boolean
    expectedVersion?: number
  },
): Promise<FlagEnvironmentResult> {
  const { enabled, ...rest } = parseInput(toggleFlagSchema, input)
  return updateFlagEnvironment(actor, { ...rest, patch: { enabled } })
}

export interface CopyFlagEnvironmentResult {
  flagKey: string
  fromEnvironmentKey: string
  toEnvironmentKey: string
  changed: boolean
  version: number
  before: StoredEnvironmentConfig
  after: StoredEnvironmentConfig
}

/** Copies selected fields (all by default) of a flag's configuration from one environment to another. */
export async function copyFlagEnvironment(
  actor: ProjectActor,
  input: CopyFlagEnvironmentInput,
): Promise<CopyFlagEnvironmentResult> {
  const { projectId, flagKey, fromEnvironmentKey, toEnvironmentKey, fields } = parseInput(
    copyFlagEnvironmentSchema,
    input,
  )
  assertProjectAccess(actor, projectId, { flag: ['promote'] })
  if (fromEnvironmentKey === toEnvironmentKey) {
    throw badRequest('Choose two different environments')
  }
  const selected = new Set(fields ?? ['enabled', 'offVariant', 'fallthrough', 'rules'])

  return db.transaction(async (tx) => {
    const flag = await findFlag(tx, projectId, flagKey)
    const fromEnv = await findEnvironment(tx, projectId, fromEnvironmentKey)
    const toEnv = await findEnvironment(tx, projectId, toEnvironmentKey)

    const [source] = await tx
      .select()
      .from(flagEnvironments)
      .where(
        and(eq(flagEnvironments.flagId, flag.id), eq(flagEnvironments.environmentId, fromEnv.id)),
      )
    if (!source) throw notFound('Flag configuration')
    const [target] = await tx
      .select()
      .from(flagEnvironments)
      .where(
        and(eq(flagEnvironments.flagId, flag.id), eq(flagEnvironments.environmentId, toEnv.id)),
      )
      .for('update')
    if (!target) throw notFound('Flag configuration')

    const before = toStoredConfig(target)
    const from = toStoredConfig(source)
    const after: StoredEnvironmentConfig = {
      enabled: selected.has('enabled') ? from.enabled : before.enabled,
      offVariant: selected.has('offVariant') ? from.offVariant : before.offVariant,
      fallthrough: selected.has('fallthrough') ? from.fallthrough : before.fallthrough,
      rules: selected.has('rules') ? from.rules : before.rules,
    }

    const configProblems = validateEnvironmentConfig(
      definitionOf(flag),
      after,
      await projectSegmentKeys(tx, projectId),
    )
    if (configProblems.length > 0) problems(configProblems)

    const result = (changed: boolean, version: number): CopyFlagEnvironmentResult => ({
      flagKey: flag.key,
      fromEnvironmentKey,
      toEnvironmentKey,
      changed,
      version,
      before,
      after,
    })
    if (jsonEqual(before, after)) return result(false, target.version)

    const updated = one(
      await tx
        .update(flagEnvironments)
        .set({ ...after, version: target.version + 1, updatedBy: persistedUserId(actor) })
        .where(eq(flagEnvironments.id, target.id))
        .returning(),
    )

    await recordAudit(tx, {
      projectId,
      environmentId: toEnv.id,
      actor: auditActor(actor),
      action: 'flag.promoted',
      entityType: 'flag',
      entityId: flag.id,
      entityKey: flag.key,
      before,
      after,
    })
    await publish({ type: 'ruleset.invalidate', projectId, environmentId: toEnv.id }, tx)
    return result(true, updated.version)
  })
}
