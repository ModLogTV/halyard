import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { flagEvaluationBuckets, flags } from '@/db/schema'
import { flushTracking, recordEvaluation } from '@/server/evaluation/tracking'
import {
  getFlagAnalytics,
  getProjectAnalytics,
  HISTORY_RETENTION_DAYS,
  pruneEvaluationHistory,
} from '@/server/services/analytics'
import type { ProjectActor } from '@/server/services/authz'
import {
  createFixtureFlag,
  createFixtureProject,
  type FixtureProject,
  truncateAll,
} from './fixtures'

const HOUR = 3_600_000
/** The service clock: half past twelve, so the current hour bucket started at 12:00. */
const NOW = new Date('2030-06-10T12:30:00.000Z')
const CURRENT_HOUR = Date.parse('2030-06-10T12:00:00.000Z')
const hoursAgo = (hours: number) => new Date(CURRENT_HOUR - hours * HOUR)
const at = (time: string) => Date.parse(`2030-06-10T${time}:00.000Z`)

function actorFor(projectId: string, role: ProjectActor['role'] = 'viewer'): ProjectActor {
  return {
    userId: 'user_analytics',
    name: 'Ana Lytics',
    email: 'ana@example.com',
    isAdmin: false,
    projectId,
    role,
  }
}

interface BucketRow {
  flagId: string
  environmentId: string
  hoursAgo: number
  variant: string
  count: number
}

async function insertBuckets(rows: BucketRow[]) {
  await db.insert(flagEvaluationBuckets).values(
    rows.map((row) => ({
      flagId: row.flagId,
      environmentId: row.environmentId,
      bucketStart: hoursAgo(row.hoursAgo),
      variant: row.variant,
      count: row.count,
    })),
  )
}

async function storedBuckets(flagId: string) {
  const rows = await db
    .select()
    .from(flagEvaluationBuckets)
    .where(eq(flagEvaluationBuckets.flagId, flagId))
    .orderBy(asc(flagEvaluationBuckets.bucketStart), asc(flagEvaluationBuckets.variant))
  return rows.map((row) => ({
    bucketStart: row.bucketStart.toISOString(),
    variant: row.variant,
    count: row.count,
  }))
}

let project: FixtureProject
let prodId: string
let devId: string

beforeEach(async () => {
  await truncateAll()
  project = await createFixtureProject()
  prodId = project.environments.production!.id
  devId = project.environments.development!.id
})

async function flag(key: string, options: { archived?: boolean } = {}) {
  return createFixtureFlag({
    projectId: project.projectId,
    key,
    archived: options.archived,
    environments: { [prodId]: {}, [devId]: {} },
  })
}

describe('evaluation history tracking', () => {
  it('counts evaluations per hour and served variant, errors without a variant', async () => {
    const { id } = await flag('checkout')
    recordEvaluation(id, prodId, 'on', at('12:05'))
    recordEvaluation(id, prodId, 'off', at('12:10'))
    recordEvaluation(id, prodId, 'on', at('12:59'))
    recordEvaluation(id, prodId, 'on', at('13:01'))
    recordEvaluation(id, prodId, undefined, at('13:02'))
    await flushTracking()

    expect(await storedBuckets(id)).toEqual([
      { bucketStart: '2030-06-10T12:00:00.000Z', variant: 'off', count: 1 },
      { bucketStart: '2030-06-10T12:00:00.000Z', variant: 'on', count: 2 },
      { bucketStart: '2030-06-10T13:00:00.000Z', variant: '', count: 1 },
      { bucketStart: '2030-06-10T13:00:00.000Z', variant: 'on', count: 1 },
    ])
  })

  it('adds to the stored bucket on later flushes', async () => {
    const { id } = await flag('checkout')
    recordEvaluation(id, prodId, 'on', at('12:05'))
    await flushTracking()
    recordEvaluation(id, prodId, 'on', at('12:20'))
    recordEvaluation(id, prodId, 'on', at('12:21'))
    await flushTracking()

    expect(await storedBuckets(id)).toEqual([
      { bucketStart: '2030-06-10T12:00:00.000Z', variant: 'on', count: 3 },
    ])
  })

  it('skips flags deleted before the flush without failing the batch', async () => {
    const kept = await flag('kept')
    const gone = await flag('gone')
    recordEvaluation(gone.id, prodId, 'on', at('12:05'))
    recordEvaluation(kept.id, prodId, 'on', at('12:05'))
    await db.delete(flags).where(eq(flags.id, gone.id))
    await flushTracking()

    expect(await storedBuckets(kept.id)).toHaveLength(1)
    expect(await storedBuckets(gone.id)).toEqual([])
  })
})

describe('getFlagAnalytics', () => {
  it('returns the hourly series, variant totals and the previous period of one environment', async () => {
    const { id } = await flag('checkout')
    await insertBuckets([
      { flagId: id, environmentId: prodId, hoursAgo: 0, variant: 'on', count: 5 },
      { flagId: id, environmentId: prodId, hoursAgo: 0, variant: 'off', count: 2 },
      { flagId: id, environmentId: prodId, hoursAgo: 1, variant: '', count: 1 },
      { flagId: id, environmentId: prodId, hoursAgo: 3, variant: 'on', count: 4 },
      { flagId: id, environmentId: prodId, hoursAgo: 23, variant: 'on', count: 1 },
      // Previous 24 hours.
      { flagId: id, environmentId: prodId, hoursAgo: 24, variant: 'on', count: 7 },
      // Older than both windows.
      { flagId: id, environmentId: prodId, hoursAgo: 48, variant: 'on', count: 100 },
      // Another environment.
      { flagId: id, environmentId: devId, hoursAgo: 0, variant: 'on', count: 50 },
    ])

    const result = await getFlagAnalytics(
      actorFor(project.projectId),
      { projectId: project.projectId, flagKey: 'checkout', environmentId: prodId, range: '24h' },
      NOW,
    )

    expect(result.window).toEqual({ range: '24h', from: hoursAgo(23), to: NOW })
    expect(result.totals).toEqual({ evaluations: 13, previous: 7, errors: 1 })
    expect(result.variants).toEqual([
      { variant: 'on', count: 10 },
      { variant: 'off', count: 2 },
      { variant: null, count: 1 },
    ])
    expect(result.series).toEqual([
      { bucketStart: hoursAgo(23), variant: 'on', count: 1 },
      { bucketStart: hoursAgo(3), variant: 'on', count: 4 },
      { bucketStart: hoursAgo(1), variant: null, count: 1 },
      { bucketStart: hoursAgo(0), variant: 'off', count: 2 },
      { bucketStart: hoursAgo(0), variant: 'on', count: 5 },
    ])
  })

  it('sums all environments when none is given', async () => {
    const { id } = await flag('checkout')
    await insertBuckets([
      { flagId: id, environmentId: prodId, hoursAgo: 0, variant: 'on', count: 5 },
      { flagId: id, environmentId: devId, hoursAgo: 0, variant: 'on', count: 50 },
    ])

    const result = await getFlagAnalytics(
      actorFor(project.projectId),
      { projectId: project.projectId, flagKey: 'checkout', range: '7d' },
      NOW,
    )

    expect(result.totals.evaluations).toBe(55)
    expect(result.series).toEqual([{ bucketStart: hoursAgo(0), variant: 'on', count: 55 }])
  })

  it('covers a day more than the range for 30 days, so the client can align local days', async () => {
    const { id } = await flag('checkout')
    await insertBuckets([
      { flagId: id, environmentId: prodId, hoursAgo: 719, variant: 'on', count: 1 },
      { flagId: id, environmentId: prodId, hoursAgo: 743, variant: 'on', count: 2 },
      { flagId: id, environmentId: prodId, hoursAgo: 744, variant: 'on', count: 4 },
    ])

    const result = await getFlagAnalytics(
      actorFor(project.projectId),
      { projectId: project.projectId, flagKey: 'checkout', range: '30d' },
      NOW,
    )

    expect(result.window.from).toEqual(hoursAgo(719))
    expect(result.series.map((row) => row.count)).toEqual([2, 1])
    // The history starts after the previous 30 days began, so there is nothing to compare.
    expect(result.totals).toEqual({ evaluations: 1, previous: null, errors: 0 })
  })

  it('compares with the previous period once the history covers it', async () => {
    const { id } = await flag('checkout')
    await insertBuckets([
      { flagId: id, environmentId: prodId, hoursAgo: 0, variant: 'on', count: 3 },
      { flagId: id, environmentId: devId, hoursAgo: 1439, variant: 'on', count: 1 },
    ])

    const result = await getFlagAnalytics(
      actorFor(project.projectId),
      { projectId: project.projectId, flagKey: 'checkout', environmentId: prodId, range: '30d' },
      NOW,
    )

    expect(result.totals).toEqual({ evaluations: 3, previous: 0, errors: 0 })
  })

  it('rejects unknown flags, environments of other projects and foreign actors', async () => {
    await flag('checkout')
    const other = await createFixtureProject()
    const actor = actorFor(project.projectId)

    await expect(
      getFlagAnalytics(actor, { projectId: project.projectId, flagKey: 'nope', range: '24h' }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      getFlagAnalytics(actor, {
        projectId: project.projectId,
        flagKey: 'checkout',
        environmentId: other.environments.production!.id,
        range: '24h',
      }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      getFlagAnalytics(actorFor(other.projectId), {
        projectId: project.projectId,
        flagKey: 'checkout',
        range: '24h',
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('getProjectAnalytics', () => {
  it('sums the project per hour and ranks the most evaluated flags', async () => {
    const a = await flag('alpha')
    const b = await flag('beta')
    const c = await flag('gamma')
    const archived = await flag('delta', { archived: true })
    const other = await createFixtureProject()
    const foreign = await createFixtureFlag({
      projectId: other.projectId,
      key: 'alpha',
      environments: { [other.environments.production!.id]: {} },
    })
    await insertBuckets([
      { flagId: a.id, environmentId: prodId, hoursAgo: 0, variant: 'on', count: 10 },
      { flagId: a.id, environmentId: prodId, hoursAgo: 2, variant: 'on', count: 5 },
      { flagId: b.id, environmentId: prodId, hoursAgo: 0, variant: 'off', count: 3 },
      { flagId: b.id, environmentId: devId, hoursAgo: 1, variant: 'on', count: 40 },
      { flagId: archived.id, environmentId: prodId, hoursAgo: 0, variant: 'on', count: 1 },
      { flagId: a.id, environmentId: prodId, hoursAgo: 30, variant: 'on', count: 8 },
      // Before both periods: the history covers the previous 24 hours.
      { flagId: c.id, environmentId: prodId, hoursAgo: 100, variant: 'on', count: 2 },
      {
        flagId: foreign.id,
        environmentId: other.environments.production!.id,
        hoursAgo: 0,
        variant: 'on',
        count: 1000,
      },
    ])

    const all = await getProjectAnalytics(
      actorFor(project.projectId),
      { projectId: project.projectId, range: '24h' },
      NOW,
    )
    expect(all.window).toEqual({ range: '24h', from: hoursAgo(23), to: NOW })
    expect(all.totals).toEqual({ evaluations: 59, previous: 8 })
    expect(all.flags).toEqual({ total: 3, evaluated: 2 })
    expect(all.series).toEqual([
      { bucketStart: hoursAgo(2), count: 5 },
      { bucketStart: hoursAgo(1), count: 40 },
      { bucketStart: hoursAgo(0), count: 14 },
    ])
    expect(all.topFlags).toEqual([
      { key: 'beta', name: 'beta', evaluations: 43 },
      { key: 'alpha', name: 'alpha', evaluations: 15 },
      { key: 'delta', name: 'delta', evaluations: 1 },
    ])

    const production = await getProjectAnalytics(
      actorFor(project.projectId),
      { projectId: project.projectId, environmentId: prodId, range: '24h' },
      NOW,
    )
    expect(production.totals).toEqual({ evaluations: 19, previous: 8 })
    expect(production.flags).toEqual({ total: 3, evaluated: 2 })
    expect(production.topFlags.map((f) => [f.key, f.evaluations])).toEqual([
      ['alpha', 15],
      ['beta', 3],
      ['delta', 1],
    ])
  })

  it('rejects foreign actors and environments', async () => {
    const other = await createFixtureProject()
    await expect(
      getProjectAnalytics(actorFor(other.projectId), {
        projectId: project.projectId,
        range: '24h',
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      getProjectAnalytics(actorFor(project.projectId), {
        projectId: project.projectId,
        environmentId: other.environments.production!.id,
        range: '24h',
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('pruneEvaluationHistory', () => {
  it('deletes buckets older than the retention window', async () => {
    const { id } = await flag('checkout')
    const retentionHours = HISTORY_RETENTION_DAYS * 24
    await insertBuckets([
      { flagId: id, environmentId: prodId, hoursAgo: 0, variant: 'on', count: 1 },
      { flagId: id, environmentId: prodId, hoursAgo: retentionHours - 1, variant: 'on', count: 1 },
      { flagId: id, environmentId: prodId, hoursAgo: retentionHours + 1, variant: 'on', count: 1 },
      { flagId: id, environmentId: devId, hoursAgo: retentionHours + 5, variant: 'on', count: 1 },
    ])

    expect(await pruneEvaluationHistory(NOW)).toBe(2)
    const remaining = await db.select().from(flagEvaluationBuckets)
    expect(remaining).toHaveLength(2)
  })
})
