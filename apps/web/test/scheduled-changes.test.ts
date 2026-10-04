import { and, eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, flagEnvironments, flags, scheduledChanges } from '@/db/schema'
import { systemActor } from '@/server/services/authz'
import {
  createFlag,
  deleteFlag,
  getFlag,
  updateFlag,
  updateFlagEnvironment,
} from '@/server/services/flags'
import {
  cancelPlan,
  cancelScheduledChange,
  createScheduledChange,
  createStagedRollout,
  listScheduledChanges,
  stagedRolloutServe,
  updateScheduledChange,
} from '@/server/services/scheduled-changes'
import {
  resetStaleScheduledChanges,
  runDueScheduledChanges,
  STALE_RUNNING_MS,
  startScheduler,
  stopScheduler,
} from '@/server/workers/scheduler'
import { captureEvents, createProjectFixture, type ProjectFixture } from './factories'
import { resetDatabase } from './helpers'

let fx: ProjectFixture
let events: ReturnType<typeof captureEvents>

beforeEach(async () => {
  await resetDatabase()
  fx = await createProjectFixture()
  events = captureEvents()
})
afterEach(() => events.stop())

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const owner = () => fx.owner.actor
const projectId = () => fx.projectId
const inFuture = (ms = HOUR) => new Date(Date.now() + ms)
/** A clock far enough ahead that every change scheduled in the tests is due. */
const later = (ms = 2 * HOUR) => new Date(Date.now() + ms)

const newBoolean = (key = 'checkout') =>
  createFlag(owner(), { projectId: projectId(), key, name: `Flag ${key}`, type: 'boolean' })

const newPlan = (key = 'plan') =>
  createFlag(owner(), {
    projectId: projectId(),
    key,
    name: 'Plan',
    type: 'string',
    variants: [
      { key: 'free', value: 'free' },
      { key: 'pro', value: 'pro' },
      { key: 'team', value: 'team' },
    ],
  })

async function configOf(flagKey: string, envKey: string) {
  const detail = await getFlag(owner(), { projectId: projectId(), flagKey })
  const config = detail.environments.find((e) => e.environmentKey === envKey)
  if (!config) throw new Error('missing environment')
  return config
}

const schedule = (
  change: Parameters<typeof createScheduledChange>[1]['change'],
  overrides: Partial<Parameters<typeof createScheduledChange>[1]> = {},
) =>
  createScheduledChange(owner(), {
    projectId: projectId(),
    flagKey: 'checkout',
    environmentKey: 'production',
    scheduledFor: inFuture(),
    change,
    ...overrides,
  })

const rowOf = async (id: string) => {
  const [row] = await db.select().from(scheduledChanges).where(eq(scheduledChanges.id, id))
  return row
}

const auditRows = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action))

describe('createScheduledChange', () => {
  it('creates a pending change with flag, environment and creator details', async () => {
    await newBoolean()
    const at = inFuture()
    const item = await schedule({ enabled: true }, { scheduledFor: at, note: 'Launch' })
    expect(item).toMatchObject({
      projectId: projectId(),
      flagKey: 'checkout',
      flagName: 'Flag checkout',
      environmentKey: 'production',
      environmentId: fx.environmentId('production'),
      status: 'pending',
      change: { enabled: true },
      note: 'Launch',
      planId: null,
      stepIndex: 0,
      createdBy: fx.owner.user.id,
      createdByName: 'Olivia Owner',
      executedAt: null,
      error: null,
    })
    expect(item.scheduledFor.getTime()).toBe(at.getTime())

    const [audit] = await auditRows('schedule.created')
    expect(audit).toMatchObject({
      actorType: 'user',
      actorId: fx.owner.user.id,
      entityType: 'schedule',
      entityId: item.id,
      entityKey: 'checkout',
      environmentId: fx.environmentId('production'),
    })
    expect(audit?.after).toMatchObject({ flagKey: 'checkout', change: { enabled: true } })
    expect(events.events).toContainEqual({ type: 'schedule.changed' })
  })

  it('assigns ids to scheduled rules', async () => {
    await newBoolean()
    const item = await schedule({
      rules: [
        {
          conditions: [{ type: 'attribute', attribute: 'country', operator: 'eq', value: 'DE' }],
          serve: { type: 'variant', variant: 'on' },
        },
      ],
    })
    expect(item.change.rules?.[0]?.id).toEqual(expect.any(String))
  })

  it('rejects times in the past, empty changes and invalid configurations', async () => {
    await newBoolean()
    await expect(
      schedule({ enabled: true }, { scheduledFor: new Date(Date.now() - 1000) }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/future/) })
    await expect(schedule({})).rejects.toMatchObject({ status: 400 })
    await expect(
      schedule({ fallthrough: { type: 'variant', variant: 'nope' } }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/nope/) })
    await expect(
      schedule({
        fallthrough: {
          type: 'rollout',
          variations: [
            { variant: 'on', weight: 40 },
            { variant: 'off', weight: 40 },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/add up to 100/) })
    await expect(
      schedule({
        rules: [
          {
            conditions: [{ type: 'segment', segmentKey: 'missing' }],
            serve: { type: 'variant', variant: 'on' },
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(schedule({ enabled: true }, { flagKey: 'missing' })).rejects.toMatchObject({
      status: 404,
    })
    await expect(schedule({ enabled: true }, { environmentKey: 'missing' })).rejects.toMatchObject({
      status: 404,
    })
    expect(await db.select().from(scheduledChanges)).toHaveLength(0)
  })

  it('requires schedule:create plus the permission the change needs', async () => {
    await newBoolean()
    const base = {
      projectId: projectId(),
      flagKey: 'checkout',
      environmentKey: 'production',
      scheduledFor: inFuture(),
    }
    await expect(
      createScheduledChange(fx.viewer.actor, { ...base, change: { enabled: true } }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      createScheduledChange(
        { ...fx.editor.actor, projectId: 'another-project' },
        { ...base, change: { enabled: true } },
      ),
    ).rejects.toMatchObject({ status: 403 })
    const item = await createScheduledChange(fx.editor.actor, {
      ...base,
      change: { enabled: true },
    })
    expect(item.createdByName).toBe('Eddie Editor')
  })
})

describe('listScheduledChanges', () => {
  it('filters by flag, environment and status and orders by time', async () => {
    await newBoolean()
    await newPlan()
    const late = await schedule({ enabled: true }, { scheduledFor: inFuture(3 * HOUR) })
    const early = await schedule({ enabled: false }, { scheduledFor: inFuture(HOUR) })
    const staging = await schedule({ enabled: true }, { environmentKey: 'staging' })
    const plan = await schedule({ enabled: true }, { flagKey: 'plan' })
    await cancelScheduledChange(owner(), { projectId: projectId(), id: staging.id })

    const all = await listScheduledChanges(fx.viewer.actor, { projectId: projectId() })
    expect(all.map((c) => c.id)).toEqual([early.id, plan.id, late.id])

    const byFlag = await listScheduledChanges(owner(), {
      projectId: projectId(),
      flagKey: 'checkout',
      environmentKey: 'production',
    })
    expect(byFlag.map((c) => c.id)).toEqual([early.id, late.id])

    const withPast = await listScheduledChanges(owner(), {
      projectId: projectId(),
      flagKey: 'checkout',
      includePast: true,
    })
    expect(withPast.map((c) => c.id).sort()).toEqual([early.id, late.id, staging.id].sort())

    const cancelled = await listScheduledChanges(owner(), {
      projectId: projectId(),
      status: 'cancelled',
    })
    expect(cancelled.map((c) => c.id)).toEqual([staging.id])
    expect(cancelled[0]).toMatchObject({ environmentKey: 'staging', flagName: 'Flag checkout' })
  })

  it('requires membership of the project', async () => {
    await expect(
      listScheduledChanges(
        { ...fx.viewer.actor, projectId: 'another-project' },
        {
          projectId: projectId(),
        },
      ),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('updateScheduledChange', () => {
  it('changes time, change and note of a pending change', async () => {
    await newBoolean()
    const item = await schedule({ enabled: true })
    events.clear()
    const at = inFuture(5 * HOUR)
    const updated = await updateScheduledChange(fx.editor.actor, {
      projectId: projectId(),
      id: item.id,
      patch: {
        scheduledFor: at,
        change: { enabled: true, fallthrough: { type: 'variant', variant: 'off' } },
        note: 'Moved',
      },
    })
    expect(updated).toMatchObject({
      status: 'pending',
      note: 'Moved',
      change: { enabled: true, fallthrough: { type: 'variant', variant: 'off' } },
    })
    expect(updated.scheduledFor.getTime()).toBe(at.getTime())
    const [audit] = await auditRows('schedule.updated')
    expect(audit?.before).toMatchObject({ change: { enabled: true }, note: null })
    expect(audit?.after).toMatchObject({ note: 'Moved' })
    expect(events.events).toContainEqual({ type: 'schedule.changed' })
  })

  it('does not write unchanged patches', async () => {
    await newBoolean()
    const item = await schedule({ enabled: true }, { note: 'Same' })
    await updateScheduledChange(owner(), {
      projectId: projectId(),
      id: item.id,
      patch: { note: 'Same', change: { enabled: true } },
    })
    expect(await auditRows('schedule.updated')).toHaveLength(0)
  })

  it('validates the patch', async () => {
    await newBoolean()
    const item = await schedule({ enabled: true })
    const update = (patch: Parameters<typeof updateScheduledChange>[1]['patch']) =>
      updateScheduledChange(owner(), { projectId: projectId(), id: item.id, patch })
    await expect(update({})).rejects.toMatchObject({ status: 400 })
    await expect(update({ scheduledFor: new Date(Date.now() - 1) })).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      update({ change: { fallthrough: { type: 'variant', variant: 'nope' } } }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      updateScheduledChange(fx.viewer.actor, {
        projectId: projectId(),
        id: item.id,
        patch: { note: 'x' },
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      updateScheduledChange(owner(), {
        projectId: projectId(),
        id: crypto.randomUUID(),
        patch: { note: 'x' },
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses to modify changes that are no longer pending', async () => {
    await newBoolean()
    const item = await schedule({ enabled: true })
    await runDueScheduledChanges(later())
    await expect(
      updateScheduledChange(owner(), { projectId: projectId(), id: item.id, patch: { note: 'x' } }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      cancelScheduledChange(owner(), { projectId: projectId(), id: item.id }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('cancelScheduledChange', () => {
  it('cancels a pending change once', async () => {
    await newBoolean()
    const item = await schedule({ enabled: true })
    events.clear()
    const cancelled = await cancelScheduledChange(fx.editor.actor, {
      projectId: projectId(),
      id: item.id,
    })
    expect(cancelled.status).toBe('cancelled')
    expect(await auditRows('schedule.cancelled')).toHaveLength(1)
    expect(events.events).toContainEqual({ type: 'schedule.changed' })
    await expect(
      cancelScheduledChange(owner(), { projectId: projectId(), id: item.id }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      updateScheduledChange(owner(), { projectId: projectId(), id: item.id, patch: { note: 'x' } }),
    ).rejects.toMatchObject({ status: 409 })

    // A cancelled change never runs.
    expect(await runDueScheduledChanges(later())).toEqual({ executed: 0, failed: 0 })
    expect((await configOf('checkout', 'production')).enabled).toBe(false)
  })

  it('is not allowed for viewers', async () => {
    await newBoolean()
    const item = await schedule({ enabled: true })
    await expect(
      cancelScheduledChange(fx.viewer.actor, { projectId: projectId(), id: item.id }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('staged rollouts', () => {
  it('computes rollout weights for each step', () => {
    expect(stagedRolloutServe(['on', 'off'], 'on', 10)).toEqual({
      type: 'rollout',
      variations: [
        { variant: 'on', weight: 10 },
        { variant: 'off', weight: 90 },
      ],
    })
    expect(stagedRolloutServe(['free', 'pro', 'team'], 'pro', 25)).toEqual({
      type: 'rollout',
      variations: [
        { variant: 'pro', weight: 25 },
        { variant: 'free', weight: 37.5 },
        { variant: 'team', weight: 37.5 },
      ],
    })
    const thirds = stagedRolloutServe(['a', 'b', 'c', 'd'], 'a', 0)
    expect(thirds.type === 'rollout' && thirds.variations.map((v) => v.weight)).toEqual([
      0, 33.334, 33.333, 33.333,
    ])
    const full = stagedRolloutServe(['a', 'b', 'c'], 'c', 100)
    expect(full.type === 'rollout' && full.variations.map((v) => v.weight)).toEqual([100, 0, 0])
  })

  it('creates one pending step per percentage sharing a plan id', async () => {
    await newBoolean()
    const times = [inFuture(HOUR), inFuture(2 * HOUR), inFuture(3 * HOUR)]
    events.clear()
    const result = await createStagedRollout(fx.editor.actor, {
      projectId: projectId(),
      flagKey: 'checkout',
      environmentKey: 'production',
      variant: 'on',
      steps: [
        { percentage: 10, at: times[0] as Date },
        { percentage: 50, at: times[1] as Date },
        { percentage: 100, at: times[2] as Date },
      ],
      note: 'Gradual launch',
    })
    expect(result.steps).toHaveLength(3)
    result.steps.forEach((step, index) => {
      expect(step).toMatchObject({
        planId: result.planId,
        stepIndex: index,
        status: 'pending',
        note: 'Gradual launch',
        flagKey: 'checkout',
        environmentKey: 'production',
      })
      expect(step.scheduledFor.getTime()).toBe(times[index]?.getTime())
    })
    expect(result.steps.map((s) => s.change)).toEqual(
      [10, 50, 100].map((p) => ({
        enabled: true,
        fallthrough: {
          type: 'rollout',
          variations: [
            { variant: 'on', weight: p },
            { variant: 'off', weight: 100 - p },
          ],
        },
      })),
    )
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityType, 'schedule'))
    expect(audits.map((a) => a.action)).toEqual(['schedule.staged_rollout_created'])
    expect(audits[0]).toMatchObject({ entityId: result.planId, entityKey: 'checkout' })
    expect(audits[0]?.after).toMatchObject({
      planId: result.planId,
      variant: 'on',
      steps: [
        { stepIndex: 0, percentage: 10 },
        { stepIndex: 1, percentage: 50 },
        { stepIndex: 2, percentage: 100 },
      ],
    })
    expect(events.events).toContainEqual({ type: 'schedule.changed' })
  })

  it('splits the remainder between the other variants of multi-variant flags', async () => {
    await newPlan()
    const result = await createStagedRollout(owner(), {
      projectId: projectId(),
      flagKey: 'plan',
      environmentKey: 'staging',
      variant: 'pro',
      steps: [{ percentage: 20, at: inFuture() }],
    })
    expect(result.steps[0]?.change.fallthrough).toEqual({
      type: 'rollout',
      variations: [
        { variant: 'pro', weight: 20 },
        { variant: 'free', weight: 40 },
        { variant: 'team', weight: 40 },
      ],
    })
  })

  it('validates steps, variant and permissions', async () => {
    await newBoolean()
    const rollout = (
      overrides: Partial<Parameters<typeof createStagedRollout>[1]>,
      actor = owner(),
    ) =>
      createStagedRollout(actor, {
        projectId: projectId(),
        flagKey: 'checkout',
        environmentKey: 'production',
        variant: 'on',
        steps: [{ percentage: 50, at: inFuture() }],
        ...overrides,
      })
    await expect(
      rollout({
        steps: [
          { percentage: 10, at: inFuture(2 * HOUR) },
          { percentage: 20, at: inFuture(HOUR) },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/increasing/) })
    const at = inFuture()
    await expect(
      rollout({
        steps: [
          { percentage: 10, at },
          { percentage: 20, at },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(rollout({ steps: [{ percentage: 101, at: inFuture() }] })).rejects.toMatchObject({
      status: 400,
    })
    await expect(rollout({ steps: [] })).rejects.toMatchObject({ status: 400 })
    await expect(
      rollout({ steps: [{ percentage: 10, at: new Date(Date.now() - MINUTE) }] }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(rollout({ variant: 'nope' })).rejects.toMatchObject({ status: 400 })
    await expect(rollout({}, fx.viewer.actor)).rejects.toMatchObject({ status: 403 })
    expect(await db.select().from(scheduledChanges)).toHaveLength(0)
  })

  it('cancels single steps or the remaining plan', async () => {
    await newBoolean()
    const { planId, steps } = await createStagedRollout(owner(), {
      projectId: projectId(),
      flagKey: 'checkout',
      environmentKey: 'production',
      variant: 'on',
      steps: [
        { percentage: 10, at: inFuture(HOUR) },
        { percentage: 50, at: inFuture(2 * HOUR) },
        { percentage: 100, at: inFuture(3 * HOUR) },
      ],
    })
    const [first, second, third] = steps
    if (!first || !second || !third) throw new Error('missing steps')

    await cancelScheduledChange(owner(), { projectId: projectId(), id: second.id })
    expect((await rowOf(first.id))?.status).toBe('pending')
    expect((await rowOf(third.id))?.status).toBe('pending')

    // The first step runs, then the rest of the plan is cancelled.
    await runDueScheduledChanges(inFuture(HOUR + MINUTE))
    expect(await cancelPlan(fx.editor.actor, { projectId: projectId(), planId })).toEqual({
      planId,
      cancelled: 1,
    })
    expect((await rowOf(first.id))?.status).toBe('completed')
    expect((await rowOf(second.id))?.status).toBe('cancelled')
    expect((await rowOf(third.id))?.status).toBe('cancelled')
    expect(await auditRows('schedule.plan_cancelled')).toHaveLength(1)

    await expect(cancelPlan(owner(), { projectId: projectId(), planId })).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      cancelPlan(owner(), { projectId: projectId(), planId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      cancelPlan(fx.viewer.actor, { projectId: projectId(), planId }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('applies the steps in order as they become due', async () => {
    await newBoolean()
    const { steps } = await createStagedRollout(owner(), {
      projectId: projectId(),
      flagKey: 'checkout',
      environmentKey: 'production',
      variant: 'on',
      steps: [
        { percentage: 10, at: inFuture(HOUR) },
        { percentage: 50, at: inFuture(2 * HOUR) },
      ],
    })
    const weightOfOn = async () => {
      const { fallthrough } = await configOf('checkout', 'production')
      return fallthrough.type === 'rollout' ? fallthrough.variations[0]?.weight : undefined
    }

    expect(await runDueScheduledChanges(inFuture(HOUR + MINUTE))).toEqual({
      executed: 1,
      failed: 0,
    })
    expect(await weightOfOn()).toBe(10)
    expect((await configOf('checkout', 'production')).enabled).toBe(true)
    expect((await rowOf(steps[1]?.id ?? ''))?.status).toBe('pending')

    expect(await runDueScheduledChanges(inFuture(2 * HOUR + MINUTE))).toEqual({
      executed: 1,
      failed: 0,
    })
    expect(await weightOfOn()).toBe(50)
  })
})

describe('runDueScheduledChanges', () => {
  it('applies due changes through the flags service as the scheduler', async () => {
    await newBoolean()
    const due = await schedule({ enabled: true }, { scheduledFor: inFuture(HOUR) })
    const notDue = await schedule(
      { fallthrough: { type: 'variant', variant: 'off' } },
      { scheduledFor: inFuture(5 * HOUR) },
    )
    const otherEnv = await schedule(
      { enabled: true },
      { environmentKey: 'staging', scheduledFor: inFuture(HOUR) },
    )

    expect(await runDueScheduledChanges(inFuture(HOUR + MINUTE))).toEqual({
      executed: 2,
      failed: 0,
    })

    const production = await configOf('checkout', 'production')
    expect(production).toMatchObject({
      enabled: true,
      fallthrough: { type: 'variant', variant: 'on' },
      version: 2,
      updatedBy: null,
    })
    expect((await configOf('checkout', 'staging')).enabled).toBe(true)
    expect((await configOf('checkout', 'development')).version).toBe(1)

    const dueRow = await rowOf(due.id)
    expect(dueRow).toMatchObject({ status: 'completed', error: null })
    expect(dueRow?.executedAt).toBeInstanceOf(Date)
    expect((await rowOf(otherEnv.id))?.status).toBe('completed')
    expect(await rowOf(notDue.id)).toMatchObject({ status: 'pending', executedAt: null })

    const toggles = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'flag.toggled'),
          eq(auditLog.environmentId, fx.environmentId('production')),
        ),
      )
    expect(toggles).toHaveLength(1)
    expect(toggles[0]).toMatchObject({ actorType: 'system', actorId: null, actorName: 'Scheduler' })

    const executed = await auditRows('schedule.executed')
    expect(executed.map((a) => a.entityId).sort()).toEqual([due.id, otherEnv.id].sort())
    expect(executed[0]).toMatchObject({ actorType: 'system', actorName: 'Scheduler' })
    expect(events.events).toContainEqual({
      type: 'ruleset.invalidate',
      projectId: projectId(),
      environmentId: fx.environmentId('production'),
    })

    // Nothing left to do until the next change is due.
    expect(await runDueScheduledChanges(inFuture(HOUR + MINUTE))).toEqual({
      executed: 0,
      failed: 0,
    })
  })

  it('does nothing when no change is due', async () => {
    await newBoolean()
    const item = await schedule({ enabled: true })
    expect(await runDueScheduledChanges()).toEqual({ executed: 0, failed: 0 })
    expect((await rowOf(item.id))?.status).toBe('pending')
    expect((await configOf('checkout', 'production')).version).toBe(1)
  })

  it('applies the patch over the current configuration without a version check', async () => {
    await newBoolean()
    await schedule({ enabled: true })
    // Someone edits the flag after the change was scheduled.
    await updateFlagEnvironment(owner(), {
      projectId: projectId(),
      flagKey: 'checkout',
      environmentKey: 'production',
      patch: { fallthrough: { type: 'variant', variant: 'off' } },
    })
    await runDueScheduledChanges(later())
    expect(await configOf('checkout', 'production')).toMatchObject({
      enabled: true,
      fallthrough: { type: 'variant', variant: 'off' },
      version: 3,
    })
  })

  it('applies every due change exactly once when runs overlap', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `flag-${i}`)
    for (const key of keys) {
      await newBoolean(key)
      await schedule({ enabled: true }, { flagKey: key, scheduledFor: inFuture(HOUR) })
    }

    // Open enough pooled connections first so the five runs really claim at the same time.
    await Promise.all(Array.from({ length: 8 }, () => db.execute(sql`select pg_sleep(0.05)`)))
    const now = later()
    const results = await Promise.all(Array.from({ length: 5 }, () => runDueScheduledChanges(now)))
    expect(results.reduce((sum, r) => sum + r.executed, 0)).toBe(10)
    expect(results.reduce((sum, r) => sum + r.failed, 0)).toBe(0)

    const configs = await db
      .select({
        key: flags.key,
        version: flagEnvironments.version,
        enabled: flagEnvironments.enabled,
      })
      .from(flagEnvironments)
      .innerJoin(flags, eq(flags.id, flagEnvironments.flagId))
      .where(eq(flagEnvironments.environmentId, fx.environmentId('production')))
    expect(configs).toHaveLength(10)
    for (const config of configs) expect(config).toMatchObject({ version: 2, enabled: true })

    const rows = await db.select().from(scheduledChanges)
    expect(rows.map((r) => r.status)).toEqual(Array(10).fill('completed'))
    expect(await auditRows('flag.toggled')).toHaveLength(10)
    expect(await auditRows('schedule.executed')).toHaveLength(10)
  })

  it('re-queues changes stuck in running after a crash', async () => {
    await newBoolean()
    await newBoolean('other')
    const stale = await schedule({ enabled: true }, { scheduledFor: inFuture(HOUR) })
    const fresh = await schedule(
      { enabled: true },
      { flagKey: 'other', scheduledFor: inFuture(HOUR) },
    )
    const now = later()
    await db
      .update(scheduledChanges)
      .set({ status: 'running', updatedAt: new Date(now.getTime() - STALE_RUNNING_MS - MINUTE) })
      .where(eq(scheduledChanges.id, stale.id))
    await db
      .update(scheduledChanges)
      .set({ status: 'running', updatedAt: new Date(now.getTime() - MINUTE) })
      .where(eq(scheduledChanges.id, fresh.id))

    expect(await runDueScheduledChanges(now)).toEqual({ executed: 1, failed: 0 })
    expect((await rowOf(stale.id))?.status).toBe('completed')
    expect((await configOf('checkout', 'production')).enabled).toBe(true)
    // Still within the lease of the replica working on it.
    expect((await rowOf(fresh.id))?.status).toBe('running')
    expect((await configOf('other', 'production')).enabled).toBe(false)

    expect(await resetStaleScheduledChanges(new Date(now.getTime() + STALE_RUNNING_MS))).toBe(1)
    expect((await rowOf(fresh.id))?.status).toBe('pending')
  })

  it('marks changes that can no longer be applied as failed', async () => {
    await newPlan()
    const item = await schedule(
      { fallthrough: { type: 'variant', variant: 'pro' } },
      { flagKey: 'plan' },
    )
    // The variant is removed after the change was scheduled.
    await updateFlag(owner(), {
      projectId: projectId(),
      flagKey: 'plan',
      patch: {
        variants: [
          { key: 'free', value: 'free' },
          { key: 'team', value: 'team' },
        ],
      },
    })

    expect(await runDueScheduledChanges(later())).toEqual({ executed: 0, failed: 1 })
    const row = await rowOf(item.id)
    expect(row?.status).toBe('failed')
    expect(row?.error).toMatch(/pro/)
    expect(row?.executedAt).toBeInstanceOf(Date)
    expect((await configOf('plan', 'production')).version).toBe(1)
    const [failure] = await auditRows('schedule.failed')
    expect(failure).toMatchObject({ actorType: 'system', entityId: item.id, entityKey: 'plan' })
    expect(failure?.after).toMatchObject({ error: expect.stringMatching(/pro/) })
  })

  it('drops scheduled changes together with their flag', async () => {
    await newBoolean()
    const item = await schedule({ enabled: true })
    await deleteFlag(owner(), { projectId: projectId(), flagKey: 'checkout' })
    expect(await rowOf(item.id)).toBeUndefined()
    expect(await runDueScheduledChanges(later())).toEqual({ executed: 0, failed: 0 })
  })
})

describe('systemActor', () => {
  it('is an owner that is audited as a system actor', () => {
    const actor = systemActor('p1', 'Scheduler')
    expect(actor).toMatchObject({ projectId: 'p1', role: 'owner', userId: 'system' })
  })
})

describe('startScheduler', () => {
  afterEach(async () => {
    await stopScheduler()
    delete process.env.SCHEDULER_INTERVAL_MS
  })

  it('polls for due changes until stopped', async () => {
    process.env.SCHEDULER_INTERVAL_MS = '50'
    await newBoolean()
    const item = await schedule({ enabled: true }, { scheduledFor: inFuture(300) })
    startScheduler()
    const deadline = Date.now() + 5_000
    while ((await rowOf(item.id))?.status !== 'completed') {
      if (Date.now() > deadline) throw new Error('scheduler did not run the change')
      await new Promise((r) => setTimeout(r, 50))
    }
    expect((await configOf('checkout', 'production')).enabled).toBe(true)
  })
})
