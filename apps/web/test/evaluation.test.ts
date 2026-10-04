import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { experimentExposures, flagEvaluationStats, flags } from '@/db/schema'
import { getRuleset } from '@/server/cache/ruleset-cache'
import { evaluateForEnvironment } from '@/server/evaluation/evaluate'
import {
  flushTracking,
  recordEvaluation,
  recordExposure,
  subjectHash,
  trackingBufferSize,
} from '@/server/evaluation/tracking'
import {
  createFixtureExperiment,
  createFixtureFlag,
  createFixtureProject,
  type FixtureProject,
  truncateAll,
} from './fixtures'

let project: FixtureProject
let envId: string
let flagId: string

const T0 = Date.parse('2030-06-01T12:00:00.000Z')
const t = (seconds: number) => T0 + seconds * 1000

async function stats() {
  await flushTracking()
  const [row] = await db
    .select()
    .from(flagEvaluationStats)
    .where(
      and(eq(flagEvaluationStats.flagId, flagId), eq(flagEvaluationStats.environmentId, envId)),
    )
  return row
}

beforeEach(async () => {
  await truncateAll()
  project = await createFixtureProject()
  envId = project.environments.production!.id
  const flag = await createFixtureFlag({
    projectId: project.projectId,
    key: 'checkout',
    environments: { [envId]: {} },
  })
  flagId = flag.id
})

describe('evaluateForEnvironment', () => {
  it('evaluates one flag or all flags and exposes flag ids', async () => {
    await createFixtureFlag({
      projectId: project.projectId,
      key: 'archived',
      archived: true,
      environments: { [envId]: {} },
    })
    const one = await evaluateForEnvironment({
      environmentId: envId,
      flagKey: 'checkout',
      context: {},
    })
    expect(one?.results).toEqual([
      { flagKey: 'checkout', value: true, variant: 'on', reason: 'STATIC' },
    ])
    expect(one?.cached.flagIds).toEqual({ checkout: flagId })

    const all = await evaluateForEnvironment({ environmentId: envId, context: {} })
    expect(all?.results.map((r) => r.flagKey)).toEqual(['checkout'])
  })

  it('returns null for unknown environments and foreign projects', async () => {
    expect(
      await evaluateForEnvironment({
        environmentId: '00000000-0000-4000-8000-000000000000',
        context: {},
      }),
    ).toBeNull()
    expect(
      await evaluateForEnvironment({ environmentId: envId, projectId: 'org_other', context: {} }),
    ).toBeNull()
  })

  it('tracks evaluations but not unknown flags', async () => {
    await evaluateForEnvironment({ environmentId: envId, flagKey: 'checkout', context: {} })
    await evaluateForEnvironment({ environmentId: envId, flagKey: 'nope', context: {} })
    expect(trackingBufferSize().stats).toBe(1)
    const row = await stats()
    expect(row).toMatchObject({ evaluationCount: 1, lastVariant: 'on' })
  })

  it('records exposures only for experiment allocations with a targeting key', async () => {
    const experiment = await createFixtureExperiment({
      projectId: project.projectId,
      flagId,
      environmentId: envId,
      key: 'exp',
      allocation: [
        { variant: 'on', weight: 50 },
        { variant: 'off', weight: 50 },
      ],
      controlVariant: 'off',
    })
    await evaluateForEnvironment({
      environmentId: envId,
      flagKey: 'checkout',
      context: { targetingKey: 'a' },
    })
    await evaluateForEnvironment({
      environmentId: envId,
      flagKey: 'checkout',
      context: { targetingKey: 'b' },
    })
    await evaluateForEnvironment({
      environmentId: envId,
      flagKey: 'checkout',
      context: { targetingKey: 'a' },
    })
    // Missing targeting key: the allocation fails, nothing is exposed.
    await evaluateForEnvironment({ environmentId: envId, flagKey: 'checkout', context: {} })
    await flushTracking()
    const rows = await db
      .select()
      .from(experimentExposures)
      .where(eq(experimentExposures.experimentId, experiment.id))
    expect(rows.map((r) => r.subjectHash).sort()).toEqual(
      [subjectHash('a'), subjectHash('b')].sort(),
    )
  })
})

describe('evaluation stats', () => {
  it('creates a row with the start of the final variant run', async () => {
    recordEvaluation(flagId, envId, 'on', t(0))
    recordEvaluation(flagId, envId, 'off', t(1))
    recordEvaluation(flagId, envId, 'off', t(2))
    const row = await stats()
    expect(row).toMatchObject({ evaluationCount: 3, lastVariant: 'off' })
    expect(row?.lastEvaluatedAt.getTime()).toBe(t(2))
    expect(row?.sameVariantSince.getTime()).toBe(t(1))
  })

  it('keeps sameVariantSince while the variant stays the same', async () => {
    recordEvaluation(flagId, envId, 'on', t(0))
    await stats()
    recordEvaluation(flagId, envId, 'on', t(10))
    recordEvaluation(flagId, envId, 'on', t(11))
    const row = await stats()
    expect(row).toMatchObject({ evaluationCount: 3, lastVariant: 'on' })
    expect(row?.sameVariantSince.getTime()).toBe(t(0))
    expect(row?.lastEvaluatedAt.getTime()).toBe(t(11))
  })

  it('resets when a window serves another variant', async () => {
    recordEvaluation(flagId, envId, 'on', t(0))
    await stats()
    recordEvaluation(flagId, envId, 'off', t(10))
    const row = await stats()
    expect(row?.lastVariant).toBe('off')
    expect(row?.sameVariantSince.getTime()).toBe(t(10))
  })

  it('resets when a window saw several variants even if it ends on the stored one', async () => {
    recordEvaluation(flagId, envId, 'on', t(0))
    await stats()
    recordEvaluation(flagId, envId, 'off', t(10))
    recordEvaluation(flagId, envId, 'on', t(11))
    recordEvaluation(flagId, envId, 'on', t(12))
    const row = await stats()
    expect(row?.lastVariant).toBe('on')
    expect(row?.sameVariantSince.getTime()).toBe(t(11))
  })

  it('ignores errors for variant tracking but counts them', async () => {
    recordEvaluation(flagId, envId, 'on', t(0))
    await stats()
    recordEvaluation(flagId, envId, undefined, t(10))
    let row = await stats()
    expect(row).toMatchObject({ evaluationCount: 2, lastVariant: 'on' })
    expect(row?.sameVariantSince.getTime()).toBe(t(0))
    expect(row?.lastEvaluatedAt.getTime()).toBe(t(10))

    recordEvaluation(flagId, envId, undefined, t(20))
    recordEvaluation(flagId, envId, 'on', t(21))
    row = await stats()
    expect(row?.sameVariantSince.getTime()).toBe(t(0))
  })

  it('does not move state backwards for windows older than the stored state', async () => {
    // Another replica already flushed a later window.
    recordEvaluation(flagId, envId, 'on', t(100))
    await stats()
    // This replica flushes an older window that served "off".
    recordEvaluation(flagId, envId, 'off', t(50))
    const row = await stats()
    expect(row?.evaluationCount).toBe(2)
    expect(row?.lastVariant).toBe('on')
    expect(row?.lastEvaluatedAt.getTime()).toBe(t(100))
    expect(row?.sameVariantSince.getTime()).toBe(t(100))
  })

  it('skips flags deleted before the flush without failing the batch', async () => {
    const other = await createFixtureFlag({
      projectId: project.projectId,
      key: 'gone',
      environments: { [envId]: {} },
    })
    recordEvaluation(other.id, envId, 'on', t(0))
    recordEvaluation(flagId, envId, 'on', t(0))
    await db.delete(flags).where(eq(flags.id, other.id))
    const row = await stats()
    expect(row?.evaluationCount).toBe(1)
    expect(trackingBufferSize()).toEqual({ stats: 0, buckets: 0, exposures: 0 })
  })

  it('does not double count with concurrent flushes', async () => {
    for (let i = 0; i < 10; i++) recordEvaluation(flagId, envId, 'on', t(i))
    await Promise.all([flushTracking(), flushTracking(), flushTracking()])
    const row = await stats()
    expect(row?.evaluationCount).toBe(10)
  })
})

describe('experiment exposures', () => {
  it('keeps the first allocation per subject', async () => {
    const experiment = await createFixtureExperiment({
      projectId: project.projectId,
      flagId,
      environmentId: envId,
      key: 'exp',
      allocation: [{ variant: 'on', weight: 100 }],
      controlVariant: 'on',
    })
    recordExposure(experiment.id, 'subject', 'on', t(0))
    await flushTracking()
    recordExposure(experiment.id, 'subject', 'off', t(10))
    recordExposure('00000000-0000-4000-8000-000000000000', 'subject', 'on', t(10))
    await flushTracking()
    const rows = await db.select().from(experimentExposures)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ subjectHash: subjectHash('subject'), variant: 'on' })
    expect(rows[0]?.firstSeenAt.getTime()).toBe(t(0))
  })
})

describe('ruleset cache', () => {
  it('maps flag keys to ids', async () => {
    const cached = await getRuleset(envId)
    expect(cached?.flagIds).toEqual({ checkout: flagId })
  })
})
