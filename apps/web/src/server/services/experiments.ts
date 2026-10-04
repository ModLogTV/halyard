import { isValidKey, type RolloutVariation, validateRolloutWeights } from '@modlogtv/halyard-engine'
import { and, desc, eq, type SQL, sql } from 'drizzle-orm'
import { type DbOrTx, db } from '@/db'
import {
  environments,
  experimentConversions,
  experimentExposures,
  experiments,
  flagEnvironments,
  flags,
} from '@/db/schema'
import { badRequest, conflict, notFound } from '@/server/errors'
import { publish } from '@/server/events'
import {
  type ConversionEvent,
  type RecordConversionsResult,
  recordConversions,
} from '@/server/experiments/conversions'
import { computeResults, type ExperimentResults } from '@/server/experiments/stats'
import {
  type CreateExperimentInput,
  createExperimentSchema,
  type ExperimentRefInput,
  experimentRefSchema,
  type ListExperimentsInput,
  listExperimentsSchema,
  type UpdateExperimentInput,
  updateExperimentSchema,
} from '../schemas/experiments'
import { recordAudit } from './audit'
import { assertProjectAccess, auditActor, type ProjectActor, persistedUserId } from './authz'
import { isUniqueViolation, jsonEqual, one, parseInput } from './util'

export type { ConversionEvent, RecordConversionsResult } from '@/server/experiments/conversions'
export { retryPendingConversions } from '@/server/experiments/conversions'
export type { ExperimentResults, VariantResult } from '@/server/experiments/stats'

export type Experiment = typeof experiments.$inferSelect
type Flag = typeof flags.$inferSelect

export interface ExperimentCounts {
  exposures: number
  conversions: number
}

export interface ExperimentListItem extends Experiment {
  flagKey: string
  flagName: string
  environmentKey: string
  counts: ExperimentCounts
}

export interface ExperimentDetail extends Experiment {
  flag: Pick<Flag, 'id' | 'key' | 'name' | 'type' | 'variants'> & { archived: boolean }
  environment: { id: string; key: string; name: string }
  results: ExperimentResults
}

const snapshot = (e: Experiment) => ({
  key: e.key,
  name: e.name,
  hypothesis: e.hypothesis,
  status: e.status,
  allocation: e.allocation,
  conversionEvent: e.conversionEvent,
  controlVariant: e.controlVariant,
  startedAt: e.startedAt?.toISOString() ?? null,
  stoppedAt: e.stoppedAt?.toISOString() ?? null,
})

async function findFlagByKey(executor: DbOrTx, projectId: string, flagKey: string) {
  const [flag] = await executor
    .select()
    .from(flags)
    .where(and(eq(flags.projectId, projectId), eq(flags.key, flagKey)))
  if (!flag) throw notFound('Flag')
  return flag
}

async function findEnvironmentByKey(executor: DbOrTx, projectId: string, environmentKey: string) {
  const [env] = await executor
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.key, environmentKey)))
  if (!env) throw notFound('Environment')
  return env
}

async function findExperiment(
  executor: DbOrTx,
  projectId: string,
  experimentKey: string,
  lock = false,
) {
  const query = executor
    .select()
    .from(experiments)
    .where(and(eq(experiments.projectId, projectId), eq(experiments.key, experimentKey)))
  const [experiment] = lock ? await query.for('update') : await query
  if (!experiment) throw notFound('Experiment')
  return experiment
}

async function flagById(executor: DbOrTx, flagId: string) {
  const [flag] = await executor.select().from(flags).where(eq(flags.id, flagId))
  if (!flag) throw notFound('Flag')
  return flag
}

/**
 * Checks an allocation against the flag: weights sum to 100, every variant exists on
 * the flag, at least two variants, and the control is allocated a positive weight.
 */
function validateAllocation(
  flag: Pick<Flag, 'key' | 'variants'>,
  allocation: RolloutVariation[],
  controlVariant: string,
): void {
  const problems = [...validateRolloutWeights(allocation)]
  const known = new Set(flag.variants.map((v) => v.key))
  for (const { variant } of allocation) {
    if (typeof variant === 'string' && variant !== '' && !known.has(variant)) {
      problems.push(`Variant "${variant}" does not exist on flag "${flag.key}"`)
    }
  }
  if (new Set(allocation.map((v) => v.variant)).size < 2) {
    problems.push('An experiment needs at least two variants')
  }
  const control = allocation.find((v) => v.variant === controlVariant)
  if (!control) {
    problems.push(`Control variant "${controlVariant}" must be part of the allocation`)
  } else if (!(control.weight > 0)) {
    problems.push(`Control variant "${controlVariant}" must have a weight above 0`)
  }
  if (problems.length > 0) throw badRequest(problems.join('; '))
}

/** Serializes starts per (flag, environment) and fails when another experiment is running. */
async function assertNoOtherRunning(tx: DbOrTx, experiment: Experiment): Promise<void> {
  await tx
    .select({ id: flagEnvironments.id })
    .from(flagEnvironments)
    .where(
      and(
        eq(flagEnvironments.flagId, experiment.flagId),
        eq(flagEnvironments.environmentId, experiment.environmentId),
      ),
    )
    .for('update')
  const [other] = await tx
    .select({ key: experiments.key })
    .from(experiments)
    .where(
      and(
        eq(experiments.flagId, experiment.flagId),
        eq(experiments.environmentId, experiment.environmentId),
        eq(experiments.status, 'running'),
      ),
    )
  if (other && other.key !== experiment.key) {
    throw conflict(
      `Experiment "${other.key}" is already running on this flag in this environment. Stop it first`,
    )
  }
}

/** Per-variant exposure and conversion counts and statistics of an experiment. */
export async function getExperimentResults(experimentId: string): Promise<ExperimentResults> {
  const [experiment] = await db.select().from(experiments).where(eq(experiments.id, experimentId))
  if (!experiment) throw notFound('Experiment')
  const rows = await db.execute<{ variant: string; exposures: number; conversions: number }>(sql`
    select variant, sum(exposures)::int as exposures, sum(conversions)::int as conversions
    from (
      select variant, count(*) as exposures, 0 as conversions
      from ${experimentExposures} where experiment_id = ${experimentId} group by variant
      union all
      select variant, 0, count(*)
      from ${experimentConversions} where experiment_id = ${experimentId} group by variant
    ) counts
    group by variant
  `)
  const byVariant = new Map(rows.rows.map((r) => [r.variant, r]))
  // Allocation order first, then variants that only appear in the data.
  const order = [
    ...experiment.allocation.map((v) => v.variant),
    ...[...byVariant.keys()].filter((v) => !experiment.allocation.some((a) => a.variant === v)),
  ]
  return computeResults({
    control: experiment.controlVariant,
    counts: order.map((variant) => ({
      variant,
      exposures: byVariant.get(variant)?.exposures ?? 0,
      conversions: byVariant.get(variant)?.conversions ?? 0,
    })),
    startedAt: experiment.startedAt,
    stoppedAt: experiment.stoppedAt,
  })
}

export async function listExperiments(
  actor: ProjectActor,
  input: ListExperimentsInput,
): Promise<ExperimentListItem[]> {
  const query = parseInput(listExperimentsSchema, input)
  assertProjectAccess(actor, query.projectId, { experiment: ['read'] })

  const conditions: SQL[] = [eq(experiments.projectId, query.projectId)]
  if (query.flagKey) conditions.push(eq(flags.key, query.flagKey))
  if (query.environmentKey) conditions.push(eq(environments.key, query.environmentKey))
  if (query.status) conditions.push(eq(experiments.status, query.status))

  const rows = await db
    .select({
      experiment: experiments,
      flagKey: flags.key,
      flagName: flags.name,
      environmentKey: environments.key,
      exposures: sql<number>`(select count(*)::int from ${experimentExposures} where ${experimentExposures.experimentId} = ${experiments.id})`,
      conversions: sql<number>`(select count(*)::int from ${experimentConversions} where ${experimentConversions.experimentId} = ${experiments.id})`,
    })
    .from(experiments)
    .innerJoin(flags, eq(flags.id, experiments.flagId))
    .innerJoin(environments, eq(environments.id, experiments.environmentId))
    .where(and(...conditions))
    .orderBy(desc(experiments.createdAt), experiments.key)

  return rows.map((row) => ({
    ...row.experiment,
    flagKey: row.flagKey,
    flagName: row.flagName,
    environmentKey: row.environmentKey,
    counts: { exposures: row.exposures, conversions: row.conversions },
  }))
}

export async function getExperiment(
  actor: ProjectActor,
  input: ExperimentRefInput,
): Promise<ExperimentDetail> {
  const { projectId, experimentKey } = parseInput(experimentRefSchema, input)
  assertProjectAccess(actor, projectId, { experiment: ['read'] })

  const experiment = await findExperiment(db, projectId, experimentKey)
  const flag = await flagById(db, experiment.flagId)
  const [env] = await db
    .select({ id: environments.id, key: environments.key, name: environments.name })
    .from(environments)
    .where(eq(environments.id, experiment.environmentId))
  if (!env) throw notFound('Environment')

  return {
    ...experiment,
    flag: {
      id: flag.id,
      key: flag.key,
      name: flag.name,
      type: flag.type,
      variants: flag.variants,
      archived: flag.archivedAt !== null,
    },
    environment: env,
    results: await getExperimentResults(experiment.id),
  }
}

/** Creates a draft experiment. Several drafts may exist for the same flag and environment. */
export async function createExperiment(
  actor: ProjectActor,
  input: CreateExperimentInput,
): Promise<Experiment> {
  const data = parseInput(createExperimentSchema, input)
  assertProjectAccess(actor, data.projectId, { experiment: ['create'] })
  if (!isValidKey(data.key)) throw badRequest(`Experiment key "${data.key}" is invalid`)

  try {
    return await db.transaction(async (tx) => {
      const flag = await findFlagByKey(tx, data.projectId, data.flagKey)
      if (flag.archivedAt) throw badRequest('Experiments cannot be created on an archived flag')
      const env = await findEnvironmentByKey(tx, data.projectId, data.environmentKey)
      validateAllocation(flag, data.allocation, data.controlVariant)

      const experiment = one(
        await tx
          .insert(experiments)
          .values({
            projectId: data.projectId,
            flagId: flag.id,
            environmentId: env.id,
            key: data.key,
            name: data.name,
            hypothesis: data.hypothesis || null,
            status: 'draft',
            allocation: data.allocation,
            conversionEvent: data.conversionEvent,
            controlVariant: data.controlVariant,
            createdBy: persistedUserId(actor),
          })
          .returning(),
      )
      await recordAudit(tx, {
        projectId: data.projectId,
        environmentId: env.id,
        actor: auditActor(actor),
        action: 'experiment.created',
        entityType: 'experiment',
        entityId: experiment.id,
        entityKey: experiment.key,
        after: { ...snapshot(experiment), flagKey: flag.key, environmentKey: env.key },
      })
      return experiment
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(`An experiment with the key "${data.key}" already exists`)
    }
    throw error
  }
}

/**
 * Updates name and hypothesis at any time. Allocation, control variant and conversion
 * event can only change while the experiment is a draft: changing them mid-flight
 * would mix subjects allocated under different splits or count different events, and
 * the results would no longer be comparable.
 */
export async function updateExperiment(
  actor: ProjectActor,
  input: UpdateExperimentInput,
): Promise<Experiment> {
  const { projectId, experimentKey, patch } = parseInput(updateExperimentSchema, input)
  assertProjectAccess(actor, projectId, { experiment: ['update'] })

  return db.transaction(async (tx) => {
    const before = await findExperiment(tx, projectId, experimentKey, true)
    const next = {
      name: patch.name ?? before.name,
      hypothesis:
        patch.hypothesis === undefined ? before.hypothesis : patch.hypothesis?.trim() || null,
      allocation: patch.allocation ?? before.allocation,
      conversionEvent: patch.conversionEvent ?? before.conversionEvent,
      controlVariant: patch.controlVariant ?? before.controlVariant,
    }

    const designChanged =
      !jsonEqual(next.allocation, before.allocation) ||
      next.conversionEvent !== before.conversionEvent ||
      next.controlVariant !== before.controlVariant
    if (designChanged && before.status !== 'draft') {
      throw badRequest(
        `Allocation, control variant and conversion event can only be changed while the experiment is a draft (it is ${before.status}). Changing them after exposures were recorded would invalidate the results; create a new experiment instead`,
      )
    }
    if (designChanged) {
      validateAllocation(await flagById(tx, before.flagId), next.allocation, next.controlVariant)
    }

    if (!designChanged && next.name === before.name && next.hypothesis === before.hypothesis) {
      return before
    }

    const after = one(
      await tx.update(experiments).set(next).where(eq(experiments.id, before.id)).returning(),
    )
    await recordAudit(tx, {
      projectId,
      environmentId: after.environmentId,
      actor: auditActor(actor),
      action: 'experiment.updated',
      entityType: 'experiment',
      entityId: after.id,
      entityKey: after.key,
      before: snapshot(before),
      after: snapshot(after),
    })
    return after
  })
}

/**
 * Starts a draft experiment. Fails with 409 while another experiment runs on the same
 * flag and environment. The environment's ruleset is invalidated so evaluations pick
 * up the allocation right away.
 */
export async function startExperiment(
  actor: ProjectActor,
  input: ExperimentRefInput,
): Promise<Experiment> {
  const { projectId, experimentKey } = parseInput(experimentRefSchema, input)
  assertProjectAccess(actor, projectId, { experiment: ['update'] })

  return db.transaction(async (tx) => {
    const before = await findExperiment(tx, projectId, experimentKey, true)
    if (before.status === 'running') throw badRequest('The experiment is already running')
    if (before.status === 'stopped') {
      throw badRequest(
        'A stopped experiment cannot be restarted, because its results would mix two periods. Create a new experiment instead',
      )
    }
    const flag = await flagById(tx, before.flagId)
    if (flag.archivedAt) throw badRequest('The flag is archived; unarchive it first')
    // The flag's variants may have changed since the draft was saved.
    validateAllocation(flag, before.allocation, before.controlVariant)
    await assertNoOtherRunning(tx, before)

    const after = one(
      await tx
        .update(experiments)
        .set({ status: 'running', startedAt: new Date(), stoppedAt: null })
        .where(eq(experiments.id, before.id))
        .returning(),
    )
    await recordAudit(tx, {
      projectId,
      environmentId: after.environmentId,
      actor: auditActor(actor),
      action: 'experiment.started',
      entityType: 'experiment',
      entityId: after.id,
      entityKey: after.key,
      before: snapshot(before),
      after: snapshot(after),
    })
    await publish({ type: 'ruleset.invalidate', projectId, environmentId: after.environmentId }, tx)
    return after
  })
}

/** Stops a running experiment; evaluations fall back to the flag's own configuration. */
export async function stopExperiment(
  actor: ProjectActor,
  input: ExperimentRefInput,
): Promise<Experiment> {
  const { projectId, experimentKey } = parseInput(experimentRefSchema, input)
  assertProjectAccess(actor, projectId, { experiment: ['update'] })

  return db.transaction(async (tx) => {
    const before = await findExperiment(tx, projectId, experimentKey, true)
    if (before.status !== 'running') {
      throw badRequest(`Only running experiments can be stopped (this one is ${before.status})`)
    }
    const after = one(
      await tx
        .update(experiments)
        .set({ status: 'stopped', stoppedAt: new Date() })
        .where(eq(experiments.id, before.id))
        .returning(),
    )
    await recordAudit(tx, {
      projectId,
      environmentId: after.environmentId,
      actor: auditActor(actor),
      action: 'experiment.stopped',
      entityType: 'experiment',
      entityId: after.id,
      entityKey: after.key,
      before: snapshot(before),
      after: snapshot(after),
    })
    await publish({ type: 'ruleset.invalidate', projectId, environmentId: after.environmentId }, tx)
    return after
  })
}

/** Deletes a draft or stopped experiment together with its exposures and conversions. */
export async function deleteExperiment(
  actor: ProjectActor,
  input: ExperimentRefInput,
): Promise<{ id: string; key: string }> {
  const { projectId, experimentKey } = parseInput(experimentRefSchema, input)
  assertProjectAccess(actor, projectId, { experiment: ['delete'] })

  return db.transaction(async (tx) => {
    const experiment = await findExperiment(tx, projectId, experimentKey, true)
    if (experiment.status === 'running') {
      throw badRequest('A running experiment cannot be deleted; stop it first')
    }
    // Exposures and conversions are removed by the foreign key cascade.
    await tx.delete(experiments).where(eq(experiments.id, experiment.id))
    await recordAudit(tx, {
      projectId,
      environmentId: experiment.environmentId,
      actor: auditActor(actor),
      action: 'experiment.deleted',
      entityType: 'experiment',
      entityId: experiment.id,
      entityKey: experiment.key,
      before: snapshot(experiment),
    })
    return { id: experiment.id, key: experiment.key }
  })
}

/**
 * Records conversion events reported through the tracking endpoint (no actor: the
 * caller authenticated with an SDK key for `environmentId`). See
 * `src/server/experiments/conversions.ts` for the attribution rules.
 */
export function recordConversion(input: {
  projectId: string
  environmentId: string
  event: string
  targetingKey: string
  occurredAt?: Date
}): Promise<RecordConversionsResult> {
  const { projectId, environmentId, ...event } = input
  return recordConversions({ projectId, environmentId, events: [event] })
}

/** Batch form of {@link recordConversion}. */
export function recordConversionBatch(input: {
  projectId: string
  environmentId: string
  events: ConversionEvent[]
}): Promise<RecordConversionsResult> {
  return recordConversions(input)
}
