import { type Serve, validateEnvironmentConfig } from '@halyard/engine'
import { and, asc, eq, inArray, notInArray, type SQL } from 'drizzle-orm'
import { type DbOrTx, db, type Transaction } from '@/db'
import {
  environments,
  flagEnvironments,
  flags,
  type ScheduledChangePayload,
  scheduledChanges,
  segments,
  user,
} from '@/db/schema'
import type { Permissions } from '@/lib/permissions'
import { badRequest, conflict, notFound } from '@/server/errors'
import { publish } from '@/server/events'
import {
  type CreateScheduledChangeInput,
  type CreateStagedRolloutInput,
  createScheduledChangeSchema,
  createStagedRolloutSchema,
  type ListScheduledChangesInput,
  listScheduledChangesSchema,
  type ScheduledChangeRefInput,
  type ScheduledPlanRefInput,
  scheduledChangeRefSchema,
  scheduledPlanRefSchema,
  type UpdateScheduledChangeInput,
  updateScheduledChangeSchema,
} from '../schemas/scheduled-changes'
import { recordAudit } from './audit'
import { assertProjectAccess, auditActor, type ProjectActor, persistedUserId } from './authz'
import { type StoredEnvironmentConfig, toStoredConfig, withRuleIds } from './flag-config'
import { permissionsForEnvironmentPatch } from './flags'
import { jsonEqual, one, parseInput } from './util'

export type ScheduledChange = typeof scheduledChanges.$inferSelect

export interface ScheduledChangeItem extends ScheduledChange {
  flagKey: string
  flagName: string
  environmentKey: string
  /** Name of the user who created the change; null when that user was deleted. */
  createdByName: string | null
}

export interface StagedRolloutResult {
  planId: string
  steps: ScheduledChangeItem[]
}

type ChangeInput = CreateScheduledChangeInput['change']

const PAST_STATUSES = ['completed', 'failed', 'cancelled'] as const

function problems(list: string[]): never {
  throw badRequest(list.join('; '))
}

/** Drops undefined fields and gives every rule an id. Throws 400 when nothing is left. */
function normalizeChange(change: ChangeInput): ScheduledChangePayload {
  const normalized: ScheduledChangePayload = {}
  if (change.enabled !== undefined) normalized.enabled = change.enabled
  if (change.fallthrough !== undefined) normalized.fallthrough = change.fallthrough as Serve
  if (change.rules !== undefined) {
    normalized.rules = withRuleIds(change.rules as Parameters<typeof withRuleIds>[0])
  }
  if (Object.keys(normalized).length === 0) throw badRequest('Provide at least one field to change')
  return normalized
}

/** `schedule:<action>` plus whatever applying the change itself requires. */
function permissionsFor(
  action: 'create' | 'update',
  change: ScheduledChangePayload | undefined,
): Permissions {
  return {
    schedule: [action],
    ...(change ? permissionsForEnvironmentPatch(change) : {}),
  }
}

function assertFuture(date: Date, now = new Date()): void {
  if (date.getTime() <= now.getTime()) throw badRequest('The scheduled time must be in the future')
}

interface Target {
  flag: typeof flags.$inferSelect
  env: typeof environments.$inferSelect
  config: StoredEnvironmentConfig
}

async function loadTarget(
  tx: DbOrTx,
  projectId: string,
  where: { flagKey: string; environmentKey: string } | { flagId: string; environmentId: string },
): Promise<Target> {
  const [flag] = await tx
    .select()
    .from(flags)
    .where(
      and(
        eq(flags.projectId, projectId),
        'flagKey' in where ? eq(flags.key, where.flagKey) : eq(flags.id, where.flagId),
      ),
    )
  if (!flag) throw notFound('Flag')
  const [env] = await tx
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.projectId, projectId),
        'environmentKey' in where
          ? eq(environments.key, where.environmentKey)
          : eq(environments.id, where.environmentId),
      ),
    )
  if (!env) throw notFound('Environment')
  const [row] = await tx
    .select()
    .from(flagEnvironments)
    .where(and(eq(flagEnvironments.flagId, flag.id), eq(flagEnvironments.environmentId, env.id)))
  if (!row) throw notFound('Flag configuration')
  return { flag, env, config: toStoredConfig(row) }
}

/**
 * Validates the configuration the change would produce if it were applied to the
 * current configuration. The flags service validates again when the change runs,
 * since the flag may change in between.
 */
async function validateChange(
  tx: DbOrTx,
  projectId: string,
  target: Target,
  change: ScheduledChangePayload,
): Promise<void> {
  const merged: StoredEnvironmentConfig = {
    enabled: change.enabled ?? target.config.enabled,
    offVariant: target.config.offVariant,
    fallthrough: change.fallthrough ?? target.config.fallthrough,
    rules: change.rules ?? target.config.rules,
  }
  const segmentKeys = (
    await tx.select({ key: segments.key }).from(segments).where(eq(segments.projectId, projectId))
  ).map((s) => s.key)
  const found = validateEnvironmentConfig(
    { key: target.flag.key, type: target.flag.type, variants: target.flag.variants },
    merged,
    segmentKeys,
  )
  if (found.length > 0) problems(found)
}

const snapshot = (row: ScheduledChange, flagKey: string, environmentKey: string) => ({
  flagKey,
  environmentKey,
  scheduledFor: row.scheduledFor.toISOString(),
  status: row.status,
  change: row.change,
  note: row.note,
  planId: row.planId,
  stepIndex: row.stepIndex,
})

async function selectItems(executor: DbOrTx, where: SQL | undefined) {
  const rows = await executor
    .select({
      change: scheduledChanges,
      flagKey: flags.key,
      flagName: flags.name,
      environmentKey: environments.key,
      createdByName: user.name,
    })
    .from(scheduledChanges)
    .innerJoin(flags, eq(flags.id, scheduledChanges.flagId))
    .innerJoin(environments, eq(environments.id, scheduledChanges.environmentId))
    .leftJoin(user, eq(user.id, scheduledChanges.createdBy))
    .where(where)
    .orderBy(
      asc(scheduledChanges.scheduledFor),
      asc(scheduledChanges.stepIndex),
      asc(scheduledChanges.createdAt),
    )
  return rows.map(
    ({ change, ...rest }): ScheduledChangeItem => ({
      ...change,
      ...rest,
      createdByName: rest.createdByName ?? null,
    }),
  )
}

async function itemById(executor: DbOrTx, id: string): Promise<ScheduledChangeItem> {
  const [item] = await selectItems(executor, eq(scheduledChanges.id, id))
  if (!item) throw notFound('Scheduled change')
  return item
}

async function lockPending(tx: Transaction, projectId: string, id: string) {
  const [row] = await tx
    .select()
    .from(scheduledChanges)
    .where(and(eq(scheduledChanges.id, id), eq(scheduledChanges.projectId, projectId)))
    .for('update')
  if (!row) throw notFound('Scheduled change')
  if (row.status !== 'pending') {
    throw conflict(`This change is ${row.status} and can no longer be modified`)
  }
  return row
}

/** Schedules a change to one flag in one environment. */
export async function createScheduledChange(
  actor: ProjectActor,
  input: CreateScheduledChangeInput,
): Promise<ScheduledChangeItem> {
  const data = parseInput(createScheduledChangeSchema, input)
  const change = normalizeChange(data.change)
  assertProjectAccess(actor, data.projectId, permissionsFor('create', change))
  assertFuture(data.scheduledFor)

  return db.transaction(async (tx) => {
    const target = await loadTarget(tx, data.projectId, data)
    await validateChange(tx, data.projectId, target, change)
    const row = one(
      await tx
        .insert(scheduledChanges)
        .values({
          projectId: data.projectId,
          flagId: target.flag.id,
          environmentId: target.env.id,
          scheduledFor: data.scheduledFor,
          change,
          note: data.note || null,
          createdBy: persistedUserId(actor),
        })
        .returning(),
    )
    await recordAudit(tx, {
      projectId: data.projectId,
      environmentId: target.env.id,
      actor: auditActor(actor),
      action: 'schedule.created',
      entityType: 'schedule',
      entityId: row.id,
      entityKey: target.flag.key,
      after: snapshot(row, target.flag.key, target.env.key),
    })
    await publish({ type: 'schedule.changed' }, tx)
    return itemById(tx, row.id)
  })
}

/**
 * The fallthrough of one staged rollout step: `variant` gets `percentage`, the other
 * variants split the remainder evenly (in thousandths of a percent; the first ones
 * get the rounding remainder). `variant` comes first so that, with the engine's
 * cumulative bucketing, everyone who got it at a lower percentage keeps it when the
 * percentage grows.
 */
export function stagedRolloutServe(
  variantKeys: string[],
  variant: string,
  percentage: number,
): Serve {
  const others = variantKeys.filter((key) => key !== variant)
  const remainder = Math.round((100 - percentage) * 1000)
  const base = others.length > 0 ? Math.floor(remainder / others.length) : 0
  const extra = remainder - base * others.length
  return {
    type: 'rollout',
    variations: [
      { variant, weight: percentage },
      ...others.map((key, index) => ({
        variant: key,
        weight: (base + (index < extra ? 1 : 0)) / 1000,
      })),
    ],
  }
}

/**
 * Creates one pending change per step, grouped by a shared `planId`. Each step
 * enables the flag and sets the fallthrough to a rollout giving `variant` the step's
 * percentage.
 */
export async function createStagedRollout(
  actor: ProjectActor,
  input: CreateStagedRolloutInput,
): Promise<StagedRolloutResult> {
  const data = parseInput(createStagedRolloutSchema, input)
  // Every step sets the fallthrough, which needs `flag:update`.
  assertProjectAccess(actor, data.projectId, { schedule: ['create'], flag: ['update'] })
  const first = data.steps[0]
  if (first) assertFuture(first.at)

  return db.transaction(async (tx) => {
    const target = await loadTarget(tx, data.projectId, data)
    const variantKeys = target.flag.variants.map((v) => v.key)
    if (!variantKeys.includes(data.variant)) {
      throw badRequest(`Variant "${data.variant}" does not exist`)
    }
    if (variantKeys.length < 2)
      throw badRequest('A staged rollout needs a flag with two or more variants')

    const changes = data.steps.map(
      (step): ScheduledChangePayload => ({
        enabled: true,
        fallthrough: stagedRolloutServe(variantKeys, data.variant, step.percentage),
      }),
    )
    for (const change of changes) await validateChange(tx, data.projectId, target, change)

    const planId = crypto.randomUUID()
    const rows = await tx
      .insert(scheduledChanges)
      .values(
        data.steps.map((step, stepIndex) => ({
          projectId: data.projectId,
          flagId: target.flag.id,
          environmentId: target.env.id,
          scheduledFor: step.at,
          change: changes[stepIndex] as ScheduledChangePayload,
          planId,
          stepIndex,
          note: data.note || null,
          createdBy: persistedUserId(actor),
        })),
      )
      .returning()
    rows.sort((a, b) => a.stepIndex - b.stepIndex)

    await recordAudit(tx, {
      projectId: data.projectId,
      environmentId: target.env.id,
      actor: auditActor(actor),
      action: 'schedule.staged_rollout_created',
      entityType: 'schedule',
      entityId: planId,
      entityKey: target.flag.key,
      after: {
        planId,
        flagKey: target.flag.key,
        environmentKey: target.env.key,
        variant: data.variant,
        note: data.note || null,
        steps: rows.map((row, index) => ({
          id: row.id,
          stepIndex: row.stepIndex,
          percentage: data.steps[index]?.percentage ?? null,
          scheduledFor: row.scheduledFor.toISOString(),
        })),
      },
    })
    await publish({ type: 'schedule.changed' }, tx)
    return { planId, steps: await selectItems(tx, eq(scheduledChanges.planId, planId)) }
  })
}

/**
 * Scheduled changes of a project ordered by `scheduledFor`. Without `status` only
 * pending and running changes are returned unless `includePast` is set.
 */
export async function listScheduledChanges(
  actor: ProjectActor,
  input: ListScheduledChangesInput,
): Promise<ScheduledChangeItem[]> {
  const query = parseInput(listScheduledChangesSchema, input)
  assertProjectAccess(actor, query.projectId, { schedule: ['read'] })

  const conditions: SQL[] = [eq(scheduledChanges.projectId, query.projectId)]
  if (query.flagKey) conditions.push(eq(flags.key, query.flagKey))
  if (query.environmentKey) conditions.push(eq(environments.key, query.environmentKey))
  if (query.status) conditions.push(eq(scheduledChanges.status, query.status))
  else if (!query.includePast) {
    conditions.push(notInArray(scheduledChanges.status, [...PAST_STATUSES]))
  }
  return selectItems(db, and(...conditions))
}

/** Changes the time, the change or the note of a pending scheduled change. */
export async function updateScheduledChange(
  actor: ProjectActor,
  input: UpdateScheduledChangeInput,
): Promise<ScheduledChangeItem> {
  const { projectId, id, patch } = parseInput(updateScheduledChangeSchema, input)
  if (Object.values(patch).every((value) => value === undefined)) {
    throw badRequest('Provide at least one field to change')
  }
  const change = patch.change ? normalizeChange(patch.change) : undefined
  assertProjectAccess(actor, projectId, permissionsFor('update', change))
  if (patch.scheduledFor) assertFuture(patch.scheduledFor)

  return db.transaction(async (tx) => {
    const before = await lockPending(tx, projectId, id)
    const target = await loadTarget(tx, projectId, before)
    if (change) await validateChange(tx, projectId, target, change)

    const next = {
      scheduledFor: patch.scheduledFor ?? before.scheduledFor,
      change: change ?? before.change,
      note: patch.note === undefined ? before.note : patch.note || null,
    }
    if (
      next.scheduledFor.getTime() === before.scheduledFor.getTime() &&
      jsonEqual(next.change, before.change) &&
      next.note === before.note
    ) {
      return itemById(tx, id)
    }

    const after = one(
      await tx.update(scheduledChanges).set(next).where(eq(scheduledChanges.id, id)).returning(),
    )
    await recordAudit(tx, {
      projectId,
      environmentId: target.env.id,
      actor: auditActor(actor),
      action: 'schedule.updated',
      entityType: 'schedule',
      entityId: id,
      entityKey: target.flag.key,
      before: snapshot(before, target.flag.key, target.env.key),
      after: snapshot(after, target.flag.key, target.env.key),
    })
    await publish({ type: 'schedule.changed' }, tx)
    return itemById(tx, id)
  })
}

/** Cancels one pending change. Other steps of its staged rollout stay scheduled. */
export async function cancelScheduledChange(
  actor: ProjectActor,
  input: ScheduledChangeRefInput,
): Promise<ScheduledChangeItem> {
  const { projectId, id } = parseInput(scheduledChangeRefSchema, input)
  assertProjectAccess(actor, projectId, { schedule: ['delete'] })

  return db.transaction(async (tx) => {
    const before = await lockPending(tx, projectId, id)
    const after = one(
      await tx
        .update(scheduledChanges)
        .set({ status: 'cancelled' })
        .where(eq(scheduledChanges.id, id))
        .returning(),
    )
    const item = await itemById(tx, id)
    await recordAudit(tx, {
      projectId,
      environmentId: before.environmentId,
      actor: auditActor(actor),
      action: 'schedule.cancelled',
      entityType: 'schedule',
      entityId: id,
      entityKey: item.flagKey,
      before: snapshot(before, item.flagKey, item.environmentKey),
      after: snapshot(after, item.flagKey, item.environmentKey),
    })
    await publish({ type: 'schedule.changed' }, tx)
    return item
  })
}

/** Cancels every pending step of a staged rollout. Steps that already ran are kept. */
export async function cancelPlan(
  actor: ProjectActor,
  input: ScheduledPlanRefInput,
): Promise<{ planId: string; cancelled: number }> {
  const { projectId, planId } = parseInput(scheduledPlanRefSchema, input)
  assertProjectAccess(actor, projectId, { schedule: ['delete'] })

  return db.transaction(async (tx) => {
    const steps = await tx
      .select()
      .from(scheduledChanges)
      .where(and(eq(scheduledChanges.projectId, projectId), eq(scheduledChanges.planId, planId)))
      .orderBy(asc(scheduledChanges.stepIndex))
      .for('update')
    const first = steps[0]
    if (!first) throw notFound('Staged rollout')
    const pending = steps.filter((step) => step.status === 'pending')
    if (pending.length === 0) throw conflict('This rollout has no pending steps left to cancel')

    await tx
      .update(scheduledChanges)
      .set({ status: 'cancelled' })
      .where(
        inArray(
          scheduledChanges.id,
          pending.map((step) => step.id),
        ),
      )
    const target = await loadTarget(tx, projectId, first)
    await recordAudit(tx, {
      projectId,
      environmentId: target.env.id,
      actor: auditActor(actor),
      action: 'schedule.plan_cancelled',
      entityType: 'schedule',
      entityId: planId,
      entityKey: target.flag.key,
      after: {
        planId,
        flagKey: target.flag.key,
        environmentKey: target.env.key,
        cancelledSteps: pending.map((step) => ({ id: step.id, stepIndex: step.stepIndex })),
      },
    })
    await publish({ type: 'schedule.changed' }, tx)
    return { planId, cancelled: pending.length }
  })
}
