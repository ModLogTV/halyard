import { and, asc, eq, inArray, lt, lte } from 'drizzle-orm'
import { db } from '@/db'
import { environments, flags, scheduledChanges } from '@/db/schema'
import { HttpError, notFound } from '@/server/errors'
import { recordAudit } from '@/server/services/audit'
import { auditActor, systemActor } from '@/server/services/authz'
import { updateFlagEnvironment } from '@/server/services/flags'
import { createPoller, intervalFromEnv, type Poller } from './poller'

/**
 * Applies due scheduled changes.
 *
 * Claiming: one transaction selects up to {@link SCHEDULER_BATCH_SIZE} pending, due
 * rows `FOR UPDATE SKIP LOCKED`, marks them `running` and commits. Replicas polling
 * at the same time skip each other's locked rows and, once committed, no longer see
 * them as pending, so every change is claimed by exactly one replica.
 *
 * Applying: each claimed change goes through `updateFlagEnvironment` as the system
 * actor "Scheduler" (no `expectedVersion`: the patch is applied over whatever the
 * configuration is at that time) and is then marked `completed` or `failed`.
 *
 * Crash recovery: a row that stays `running` for longer than {@link STALE_RUNNING_MS}
 * (its replica died between claim and completion) is put back to `pending` and
 * claimed again. Patches set absolute values, so applying one twice is harmless
 * (the second application is a no-op and does not bump the version).
 */
export const SCHEDULER_BATCH_SIZE = 20
export const STALE_RUNNING_MS = 5 * 60_000
export const SCHEDULER_ACTOR_NAME = 'Scheduler'
const DEFAULT_INTERVAL_MS = 15_000

type ScheduledChangeRow = typeof scheduledChanges.$inferSelect

export interface SchedulerRunResult {
  executed: number
  failed: number
}

/** Returns rows stuck in `running` for longer than {@link STALE_RUNNING_MS} to `pending`. */
export async function resetStaleScheduledChanges(now = new Date()): Promise<number> {
  const reset = await db
    .update(scheduledChanges)
    .set({ status: 'pending', updatedAt: now })
    .where(
      and(
        eq(scheduledChanges.status, 'running'),
        lt(scheduledChanges.updatedAt, new Date(now.getTime() - STALE_RUNNING_MS)),
      ),
    )
    .returning({ id: scheduledChanges.id })
  if (reset.length > 0) {
    console.warn(`scheduler: re-queued ${reset.length} scheduled change(s) stuck in running`)
  }
  return reset.length
}

async function claimDue(now: Date): Promise<ScheduledChangeRow[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: scheduledChanges.id })
      .from(scheduledChanges)
      .where(and(eq(scheduledChanges.status, 'pending'), lte(scheduledChanges.scheduledFor, now)))
      .orderBy(asc(scheduledChanges.scheduledFor), asc(scheduledChanges.stepIndex))
      .limit(SCHEDULER_BATCH_SIZE)
      .for('update', { skipLocked: true })
    if (due.length === 0) return []
    const claimed = await tx
      .update(scheduledChanges)
      .set({ status: 'running', updatedAt: now })
      .where(
        inArray(
          scheduledChanges.id,
          due.map((row) => row.id),
        ),
      )
      .returning()
    return claimed.sort(
      (a, b) =>
        a.scheduledFor.getTime() - b.scheduledFor.getTime() ||
        a.stepIndex - b.stepIndex ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
  })
}

async function finish(
  row: ScheduledChangeRow,
  flagKey: string | null,
  error: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(scheduledChanges)
      .set({ status: error ? 'failed' : 'completed', executedAt: new Date(), error })
      .where(and(eq(scheduledChanges.id, row.id), eq(scheduledChanges.status, 'running')))
      .returning()
    // Gone (flag deleted meanwhile) or reset by another replica: nothing to record.
    if (!updated) return
    await recordAudit(tx, {
      projectId: row.projectId,
      environmentId: row.environmentId,
      actor: auditActor(systemActor(row.projectId, SCHEDULER_ACTOR_NAME)),
      action: error ? 'schedule.failed' : 'schedule.executed',
      entityType: 'schedule',
      entityId: row.id,
      entityKey: flagKey,
      after: {
        change: row.change,
        planId: row.planId,
        stepIndex: row.stepIndex,
        scheduledFor: row.scheduledFor.toISOString(),
        error,
      },
    })
  })
}

async function findTarget(row: ScheduledChangeRow) {
  const [target] = await db
    .select({ flagKey: flags.key, environmentKey: environments.key })
    .from(flags)
    .innerJoin(environments, eq(environments.id, row.environmentId))
    .where(eq(flags.id, row.flagId))
  return target
}

async function apply(
  row: ScheduledChangeRow,
  target: { flagKey: string; environmentKey: string } | undefined,
): Promise<void> {
  if (!target) throw notFound('Flag or environment')
  await updateFlagEnvironment(systemActor(row.projectId, SCHEDULER_ACTOR_NAME), {
    projectId: row.projectId,
    flagKey: target.flagKey,
    environmentKey: target.environmentKey,
    patch: row.change,
  })
}

const describeError = (error: unknown) =>
  error instanceof HttpError
    ? error.message
    : error instanceof Error
      ? error.message || error.name
      : String(error)

/**
 * Claims and applies one batch of due scheduled changes. Safe to call concurrently,
 * from one or many replicas: every change is applied exactly once.
 */
export async function runDueScheduledChanges(now = new Date()): Promise<SchedulerRunResult> {
  await resetStaleScheduledChanges(now)
  const claimed = await claimDue(now)
  const result: SchedulerRunResult = { executed: 0, failed: 0 }
  if (claimed.length === 0) return result

  // Sequential, so steps of one flag are applied in schedule order.
  for (const row of claimed) {
    let error: string | null = null
    const target = await findTarget(row)
    try {
      await apply(row, target)
    } catch (caught) {
      error = describeError(caught)
      if (!(caught instanceof HttpError)) {
        console.error(`scheduler: scheduled change ${row.id} failed`, caught)
      }
    }
    await finish(row, target?.flagKey ?? null, error)
    if (error) result.failed += 1
    else result.executed += 1
  }
  return result
}

let poller: Poller | undefined

/**
 * Starts the scheduler loop: every `SCHEDULER_INTERVAL_MS` (default 15 s) and shortly
 * after a `schedule.changed` event. Idempotent.
 */
export function startScheduler(): void {
  if (poller) return
  poller = createPoller({
    name: 'scheduler',
    intervalMs: intervalFromEnv('SCHEDULER_INTERVAL_MS', DEFAULT_INTERVAL_MS),
    events: ['schedule.changed'],
    tick: async () => {
      const { executed, failed } = await runDueScheduledChanges()
      return executed + failed >= SCHEDULER_BATCH_SIZE
    },
  })
  poller.start()
}

export async function stopScheduler(): Promise<void> {
  const current = poller
  poller = undefined
  await current?.stop()
}
