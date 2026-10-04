import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { experimentConversions, experimentExposures } from '@/db/schema'
import { evaluateForEnvironment } from '@/server/evaluation/evaluate'
import { flushTracking, resetTracking, subjectHash } from '@/server/evaluation/tracking'
import {
  PENDING_TTL_MS,
  pendingConversionCount,
  resetPendingConversions,
  retryPendingConversions,
} from '@/server/experiments/conversions'
import { computeResults } from '@/server/experiments/stats'
import { handleTrack, trackPreflight } from '@/server/experiments/track-handler'
import {
  createExperiment,
  getExperiment,
  recordConversion,
  startExperiment,
  stopExperiment,
} from '@/server/services/experiments'
import { createFlag, toggleFlag } from '@/server/services/flags'
import { createProjectFixture, type ProjectFixture } from './factories'
import { createFixtureSdkKey } from './fixtures'
import { resetDatabase } from './helpers'

const URL = 'http://localhost:3000/api/v1/track'

let fx: ProjectFixture
let experimentId: string
let sdkKey: string
let envId: string

beforeEach(async () => {
  await resetDatabase()
  resetTracking()
  resetPendingConversions()
  fx = await createProjectFixture()
  const owner = fx.owner.actor
  const projectId = fx.projectId
  envId = fx.environmentId('production')
  await createFlag(owner, {
    projectId,
    key: 'button-color',
    name: 'Button color',
    type: 'string',
    variants: [
      { key: 'blue', value: 'blue' },
      { key: 'green', value: 'green' },
    ],
  })
  await toggleFlag(owner, {
    projectId,
    flagKey: 'button-color',
    environmentKey: 'production',
    enabled: true,
  })
  const experiment = await createExperiment(owner, {
    projectId,
    flagKey: 'button-color',
    environmentKey: 'production',
    key: 'color-test',
    name: 'Color test',
    allocation: [
      { variant: 'blue', weight: 50 },
      { variant: 'green', weight: 50 },
    ],
    conversionEvent: 'purchase',
    controlVariant: 'blue',
  })
  experimentId = experiment.id
  await startExperiment(owner, { projectId, experimentKey: 'color-test' })
  sdkKey = await createFixtureSdkKey(projectId, envId)
})

afterEach(() => resetPendingConversions())

const post = (body: unknown, key: string | null = sdkKey) =>
  handleTrack(
    new Request(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

/** Evaluates the flag for a subject (recording a buffered exposure) and returns the variant. */
async function expose(targetingKey: string, environmentId = envId): Promise<string> {
  const evaluation = await evaluateForEnvironment({
    environmentId,
    projectId: fx.projectId,
    flagKey: 'button-color',
    context: { targetingKey },
  })
  const details = evaluation?.results[0]
  if (!details?.variant) throw new Error('no variant served')
  return details.variant
}

const conversions = () =>
  db
    .select()
    .from(experimentConversions)
    .where(eq(experimentConversions.experimentId, experimentId))

describe('POST /api/v1/track', () => {
  it('records a conversion with the exposed variant', async () => {
    const variant = await expose('user-1')
    await flushTracking()
    const [exposure] = await db.select().from(experimentExposures)
    expect(exposure).toMatchObject({ experimentId, subjectHash: subjectHash('user-1'), variant })

    const response = await post({ event: 'purchase', targetingKey: 'user-1' })
    expect(response.status).toBe(202)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.json()).toEqual({ accepted: 1, matched: 1 })

    const rows = await conversions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ subjectHash: subjectHash('user-1'), variant })
  })

  it('ignores conversions of subjects that were never exposed', async () => {
    await expose('user-1')
    await flushTracking()
    const response = await post({ event: 'purchase', targetingKey: 'stranger' })
    expect(await response.json()).toEqual({ accepted: 1, matched: 0 })
    expect(await conversions()).toEqual([])

    // The conversion waits for a possibly late exposure, then expires.
    expect(pendingConversionCount()).toBe(1)
    await retryPendingConversions(Date.now() + PENDING_TTL_MS + 1)
    expect(pendingConversionCount()).toBe(0)
    expect(await conversions()).toEqual([])
  })

  it('ignores events other than the conversion event', async () => {
    await expose('user-1')
    await flushTracking()
    const response = await post({ event: 'page_view', targetingKey: 'user-1' })
    expect(await response.json()).toEqual({ accepted: 1, matched: 0 })
    expect(await conversions()).toEqual([])
    expect(pendingConversionCount()).toBe(0)
  })

  it('counts the first conversion per subject only', async () => {
    await expose('user-1')
    await flushTracking()
    const first = await post({
      event: 'purchase',
      targetingKey: 'user-1',
      timestamp: '2026-03-01T10:00:00Z',
    })
    expect(await first.json()).toEqual({ accepted: 1, matched: 1 })
    const second = await post({
      event: 'purchase',
      targetingKey: 'user-1',
      timestamp: '2026-03-01T11:00:00Z',
    })
    expect(await second.json()).toEqual({ accepted: 1, matched: 1 })

    const rows = await conversions()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.convertedAt.toISOString()).toBe('2026-03-01T10:00:00.000Z')
  })

  it('accepts a batch and ignores `value`', async () => {
    const a = await expose('user-a')
    const b = await expose('user-b')
    await flushTracking()
    const response = await post([
      { event: 'purchase', targetingKey: 'user-a', value: 49.9 },
      { event: 'purchase', targetingKey: 'user-b' },
      { event: 'purchase', targetingKey: 'user-b' },
      { event: 'signup', targetingKey: 'user-a' },
    ])
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: 4, matched: 3 })
    const rows = await conversions()
    expect(rows.map((r) => [r.subjectHash, r.variant]).sort()).toEqual(
      [
        [subjectHash('user-a'), a],
        [subjectHash('user-b'), b],
      ].sort(),
    )
  })

  it('clamps future timestamps to the time of receipt', async () => {
    await expose('user-1')
    await flushTracking()
    await post({ event: 'purchase', targetingKey: 'user-1', timestamp: '2999-01-01T00:00:00Z' })
    const [row] = await conversions()
    expect(row?.convertedAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('stops counting once the experiment is stopped', async () => {
    await expose('user-1')
    await flushTracking()
    await stopExperiment(fx.owner.actor, { projectId: fx.projectId, experimentKey: 'color-test' })
    const response = await post({ event: 'purchase', targetingKey: 'user-1' })
    expect(await response.json()).toEqual({ accepted: 1, matched: 0 })
    expect(await conversions()).toEqual([])
  })

  it('only matches experiments in the SDK key environment', async () => {
    await expose('user-1')
    await flushTracking()
    const devKey = await createFixtureSdkKey(fx.projectId, fx.environmentId('development'))
    const response = await post({ event: 'purchase', targetingKey: 'user-1' }, devKey)
    expect(await response.json()).toEqual({ accepted: 1, matched: 0 })
    expect(await conversions()).toEqual([])
  })

  describe('conversion before the exposure is flushed', () => {
    it('keeps the conversion pending and records it once the exposure is written', async () => {
      const variant = await expose('early-bird')
      // The exposure is still in the in-memory buffer.
      expect(await db.select().from(experimentExposures)).toEqual([])

      const response = await post({ event: 'purchase', targetingKey: 'early-bird' })
      expect(await response.json()).toEqual({ accepted: 1, matched: 0 })
      expect(pendingConversionCount()).toBe(1)
      expect(await conversions()).toEqual([])

      await flushTracking()
      await retryPendingConversions()
      expect(pendingConversionCount()).toBe(0)
      const rows = await conversions()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ subjectHash: subjectHash('early-bird'), variant })
    })

    it('drops a pending conversion whose exposure never arrives within the TTL', async () => {
      await expose('late')
      await post({ event: 'purchase', targetingKey: 'late' })
      expect(pendingConversionCount()).toBe(1)
      await retryPendingConversions(Date.now() + PENDING_TTL_MS + 1)
      expect(pendingConversionCount()).toBe(0)
      await flushTracking()
      await retryPendingConversions()
      expect(await conversions()).toEqual([])
    })

    it('keeps one pending entry per subject with the earliest time', async () => {
      await expose('dup')
      await post({ event: 'purchase', targetingKey: 'dup', timestamp: '2026-03-01T12:00:00Z' })
      await post({ event: 'purchase', targetingKey: 'dup', timestamp: '2026-03-01T09:00:00Z' })
      expect(pendingConversionCount()).toBe(1)
      await flushTracking()
      await retryPendingConversions()
      const [row] = await conversions()
      expect(row?.convertedAt.toISOString()).toBe('2026-03-01T09:00:00.000Z')
    })
  })

  describe('validation and authentication', () => {
    it.each([
      ['not JSON', '{nope'],
      ['an empty body', ''],
      ['a missing targetingKey', { event: 'purchase' }],
      ['an empty event', { event: '', targetingKey: 'u' }],
      ['a non-numeric value', { event: 'purchase', targetingKey: 'u', value: 'x' }],
      ['an invalid timestamp', { event: 'purchase', targetingKey: 'u', timestamp: 'yesterday' }],
      ['an empty batch', []],
      [
        'more than 100 events',
        Array.from({ length: 101 }, (_, i) => ({ event: 'purchase', targetingKey: `u${i}` })),
      ],
    ])('rejects %s with 400', async (_label, body) => {
      const response = await post(body)
      expect(response.status).toBe(400)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    })

    it('accepts exactly 100 events', async () => {
      const body = Array.from({ length: 100 }, (_, i) => ({
        event: 'purchase',
        targetingKey: `u${i}`,
      }))
      const response = await post(body)
      expect(response.status).toBe(202)
      expect(await response.json()).toEqual({ accepted: 100, matched: 0 })
    })

    it('rejects a missing or invalid key with 401', async () => {
      const missing = await post({ event: 'purchase', targetingKey: 'u' }, null)
      expect(missing.status).toBe(401)
      expect(missing.headers.get('access-control-allow-origin')).toBe('*')
      const invalid = await post({ event: 'purchase', targetingKey: 'u' }, 'hal_sdk_invalid')
      expect(invalid.status).toBe(401)
    })

    it('answers the CORS preflight', () => {
      const response = trackPreflight()
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('access-control-allow-methods')).toContain('POST')
      expect(response.headers.get('access-control-allow-headers')).toContain('Authorization')
    })
  })
})

describe('recordConversion', () => {
  it('returns the number of matched experiments', async () => {
    await expose('user-1')
    await flushTracking()
    expect(
      await recordConversion({
        projectId: fx.projectId,
        environmentId: envId,
        event: 'purchase',
        targetingKey: 'user-1',
      }),
    ).toEqual({ matched: 1, pending: 0 })
  })

  it('does not match an environment of another project', async () => {
    await expose('user-1')
    await flushTracking()
    expect(
      await recordConversion({
        projectId: 'another-project',
        environmentId: envId,
        event: 'purchase',
        targetingKey: 'user-1',
      }),
    ).toEqual({ matched: 0, pending: 0 })
  })
})

describe('results end to end', () => {
  it('match the stats module for the recorded exposures and conversions', async () => {
    const assigned = new Map<string, string>()
    for (let i = 0; i < 300; i += 1) assigned.set(`subject-${i}`, await expose(`subject-${i}`))
    await flushTracking()

    // Every third blue subject and every second green subject converts.
    const converting = [...assigned].filter(([key, variant]) => {
      const n = Number(key.split('-')[1])
      return variant === 'blue' ? n % 3 === 0 : n % 2 === 0
    })
    for (let offset = 0; offset < converting.length; offset += 100) {
      const batch = converting
        .slice(offset, offset + 100)
        .map(([targetingKey]) => ({ event: 'purchase', targetingKey }))
      const response = await post(batch)
      expect(await response.json()).toEqual({ accepted: batch.length, matched: batch.length })
    }

    const count = (variant: string, list: [string, string][]) =>
      list.filter(([, v]) => v === variant).length
    const all = [...assigned]
    const detail = await getExperiment(fx.owner.actor, {
      projectId: fx.projectId,
      experimentKey: 'color-test',
    })
    expect(detail.results).toEqual(
      computeResults({
        control: 'blue',
        counts: [
          {
            variant: 'blue',
            exposures: count('blue', all),
            conversions: count('blue', converting),
          },
          {
            variant: 'green',
            exposures: count('green', all),
            conversions: count('green', converting),
          },
        ],
        startedAt: detail.startedAt,
        stoppedAt: null,
      }),
    )
    expect(detail.results.totalExposures).toBe(300)
    expect(detail.results.totalConversions).toBe(converting.length)

    const stored = await db
      .select()
      .from(experimentConversions)
      .innerJoin(
        experimentExposures,
        and(
          eq(experimentExposures.experimentId, experimentConversions.experimentId),
          eq(experimentExposures.subjectHash, experimentConversions.subjectHash),
        ),
      )
    expect(
      stored.every((r) => r.experiment_conversions.variant === r.experiment_exposures.variant),
    ).toBe(true)
  })
})
