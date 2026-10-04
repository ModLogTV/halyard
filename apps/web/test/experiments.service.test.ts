import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, experimentConversions, experimentExposures, experiments } from '@/db/schema'
import { getRuleset } from '@/server/cache/ruleset-cache'
import { HttpError } from '@/server/errors'
import { resetTracking } from '@/server/evaluation/tracking'
import { resetPendingConversions } from '@/server/experiments/conversions'
import { computeResults } from '@/server/experiments/stats'
import type { CreateExperimentInput } from '@/server/schemas/experiments'
import {
  createExperiment,
  deleteExperiment,
  getExperiment,
  getExperimentResults,
  listExperiments,
  startExperiment,
  stopExperiment,
  updateExperiment,
} from '@/server/services/experiments'
import { archiveFlag, createFlag, updateFlag } from '@/server/services/flags'
import { captureEvents, createProjectFixture, type ProjectFixture } from './factories'
import { resetDatabase } from './helpers'

let fx: ProjectFixture
let events: ReturnType<typeof captureEvents>
afterEach(() => events.stop())

beforeEach(async () => {
  await resetDatabase()
  resetTracking()
  resetPendingConversions()
  fx = await createProjectFixture()
  await createFlag(fx.owner.actor, {
    projectId: fx.projectId,
    key: 'button-color',
    name: 'Button color',
    type: 'string',
    variants: [
      { key: 'blue', value: 'blue' },
      { key: 'green', value: 'green' },
      { key: 'red', value: 'red' },
    ],
  })
  events = captureEvents()
})

const owner = () => fx.owner.actor
const projectId = () => fx.projectId

const draft = (overrides: Partial<CreateExperimentInput> = {}) =>
  createExperiment(owner(), {
    projectId: projectId(),
    flagKey: 'button-color',
    environmentKey: 'production',
    key: 'color-test',
    name: 'Color test',
    hypothesis: 'Green converts better',
    allocation: [
      { variant: 'blue', weight: 50 },
      { variant: 'green', weight: 50 },
    ],
    conversionEvent: 'purchase',
    controlVariant: 'blue',
    ...overrides,
  })

const ref = (experimentKey = 'color-test') => ({ projectId: projectId(), experimentKey })

const auditActions = async () =>
  (
    await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityType, 'experiment'))
      .orderBy(auditLog.createdAt)
  ).map((a) => a.action)

async function expectHttpError(promise: Promise<unknown>, status: number, message?: RegExp) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(HttpError)
  expect((error as HttpError).status).toBe(status)
  if (message) expect((error as HttpError).message).toMatch(message)
}

async function seedCounts(
  experimentId: string,
  variant: string,
  exposed: number,
  converted: number,
) {
  if (exposed === 0) return
  const subjects = Array.from({ length: exposed }, (_, i) => `${variant}-${i}`)
  await db
    .insert(experimentExposures)
    .values(subjects.map((subjectHash) => ({ experimentId, subjectHash, variant })))
  if (converted > 0) {
    await db
      .insert(experimentConversions)
      .values(
        subjects.slice(0, converted).map((subjectHash) => ({ experimentId, subjectHash, variant })),
      )
  }
}

describe('createExperiment', () => {
  it('creates a draft experiment and audits it', async () => {
    const experiment = await draft()
    expect(experiment).toMatchObject({
      key: 'color-test',
      name: 'Color test',
      hypothesis: 'Green converts better',
      status: 'draft',
      conversionEvent: 'purchase',
      controlVariant: 'blue',
      environmentId: fx.environmentId('production'),
      startedAt: null,
      stoppedAt: null,
      createdBy: fx.owner.user.id,
    })
    expect(await auditActions()).toEqual(['experiment.created'])
    const [row] = await db.select().from(auditLog).where(eq(auditLog.entityType, 'experiment'))
    expect(row).toMatchObject({
      entityType: 'experiment',
      entityKey: 'color-test',
      environmentId: fx.environmentId('production'),
    })
    // Drafts are not part of the ruleset, so nothing is invalidated.
    expect(events.events).toEqual([])
  })

  it('rejects weights that do not add up to 100', async () => {
    await expectHttpError(
      draft({
        allocation: [
          { variant: 'blue', weight: 50 },
          { variant: 'green', weight: 40 },
        ],
      }),
      400,
      /100/,
    )
  })

  it('rejects variants the flag does not have', async () => {
    await expectHttpError(
      draft({
        allocation: [
          { variant: 'blue', weight: 50 },
          { variant: 'purple', weight: 50 },
        ],
      }),
      400,
      /"purple" does not exist/,
    )
  })

  it('rejects a control variant outside the allocation', async () => {
    await expectHttpError(draft({ controlVariant: 'red' }), 400, /Control variant "red"/)
  })

  it('rejects a control variant without weight', async () => {
    await expectHttpError(
      draft({
        allocation: [
          { variant: 'blue', weight: 0 },
          { variant: 'green', weight: 100 },
        ],
      }),
      400,
      /weight above 0/,
    )
  })

  it('requires at least two variants', async () => {
    await expectHttpError(
      draft({ allocation: [{ variant: 'blue', weight: 100 }] }),
      400,
      /at least two variants/,
    )
  })

  it('validates the key and the conversion event', async () => {
    await expectHttpError(draft({ key: '-bad key' }), 400)
    await expectHttpError(draft({ conversionEvent: '  ' }), 400, /Conversion event/)
  })

  it('returns 404 for unknown flags and environments', async () => {
    await expectHttpError(draft({ flagKey: 'missing' }), 404, /Flag/)
    await expectHttpError(draft({ environmentKey: 'missing' }), 404, /Environment/)
  })

  it('rejects duplicate keys with 409', async () => {
    await draft()
    await expectHttpError(draft({ environmentKey: 'staging' }), 409, /already exists/)
  })

  it('rejects archived flags', async () => {
    await archiveFlag(owner(), { projectId: projectId(), flagKey: 'button-color' })
    await expectHttpError(draft(), 400, /archived/)
  })

  it('lets several drafts coexist on the same flag and environment', async () => {
    await draft()
    await draft({ key: 'color-test-2' })
    const list = await listExperiments(owner(), { projectId: projectId() })
    expect(list.map((e) => e.key).sort()).toEqual(['color-test', 'color-test-2'])
  })
})

describe('startExperiment / stopExperiment', () => {
  it('starts a draft, audits it and invalidates the environment ruleset', async () => {
    await draft()
    const envId = fx.environmentId('production')
    expect(
      (await getRuleset(envId))?.ruleset.flags['button-color']?.config.experiment,
    ).toBeUndefined()

    const started = await startExperiment(owner(), ref())
    expect(started.status).toBe('running')
    expect(started.startedAt).toBeInstanceOf(Date)
    expect(events.events).toContainEqual({
      type: 'ruleset.invalidate',
      projectId: projectId(),
      environmentId: envId,
    })
    expect(await auditActions()).toEqual(['experiment.created', 'experiment.started'])

    const cached = await getRuleset(envId)
    expect(cached?.ruleset.flags['button-color']?.config.experiment).toEqual({
      key: 'color-test',
      variations: [
        { variant: 'blue', weight: 50 },
        { variant: 'green', weight: 50 },
      ],
    })
    expect(cached?.experimentIds['color-test']).toBe(started.id)
  })

  it('stops a running experiment, audits it and removes it from the ruleset', async () => {
    await draft()
    await startExperiment(owner(), ref())
    const envId = fx.environmentId('production')
    await getRuleset(envId)
    events.clear()

    const stopped = await stopExperiment(owner(), ref())
    expect(stopped.status).toBe('stopped')
    expect(stopped.stoppedAt).toBeInstanceOf(Date)
    expect(events.events).toEqual([
      { type: 'ruleset.invalidate', projectId: projectId(), environmentId: envId },
    ])
    expect(await auditActions()).toEqual([
      'experiment.created',
      'experiment.started',
      'experiment.stopped',
    ])
    expect(
      (await getRuleset(envId))?.ruleset.flags['button-color']?.config.experiment,
    ).toBeUndefined()
  })

  it('allows only one running experiment per flag and environment', async () => {
    await draft()
    await draft({ key: 'other' })
    await draft({ key: 'in-staging', environmentKey: 'staging' })
    await startExperiment(owner(), ref())

    await expectHttpError(
      startExperiment(owner(), ref('other')),
      409,
      /"color-test" is already running/,
    )
    // Another environment is independent.
    await startExperiment(owner(), ref('in-staging'))

    await stopExperiment(owner(), ref())
    expect((await startExperiment(owner(), ref('other'))).status).toBe('running')
  })

  it('rejects invalid transitions', async () => {
    await draft()
    await expectHttpError(stopExperiment(owner(), ref()), 400, /Only running/)
    await startExperiment(owner(), ref())
    await expectHttpError(startExperiment(owner(), ref()), 400, /already running/)
    await stopExperiment(owner(), ref())
    await expectHttpError(startExperiment(owner(), ref()), 400, /cannot be restarted/)
    await expectHttpError(stopExperiment(owner(), ref()), 400, /Only running/)
    await expectHttpError(startExperiment(owner(), ref('missing')), 404)
  })

  it('re-validates the allocation against the current flag variants', async () => {
    await draft()
    // Drafts do not block variant removal (only running experiments do).
    await updateFlag(owner(), {
      projectId: projectId(),
      flagKey: 'button-color',
      patch: {
        variants: [
          { key: 'blue', value: 'blue' },
          { key: 'red', value: 'red' },
        ],
      },
    })
    await expectHttpError(startExperiment(owner(), ref()), 400, /"green" does not exist/)
  })
})

describe('updateExperiment', () => {
  it('updates every field of a draft', async () => {
    await draft()
    const updated = await updateExperiment(owner(), {
      ...ref(),
      patch: {
        name: 'Renamed',
        hypothesis: null,
        allocation: [
          { variant: 'blue', weight: 34 },
          { variant: 'green', weight: 33 },
          { variant: 'red', weight: 33 },
        ],
        conversionEvent: 'signup',
        controlVariant: 'green',
      },
    })
    expect(updated).toMatchObject({
      name: 'Renamed',
      hypothesis: null,
      conversionEvent: 'signup',
      controlVariant: 'green',
    })
    expect(updated.allocation).toHaveLength(3)
    expect(await auditActions()).toEqual(['experiment.created', 'experiment.updated'])
  })

  it('validates a changed allocation', async () => {
    await draft()
    await expectHttpError(
      updateExperiment(owner(), { ...ref(), patch: { controlVariant: 'red' } }),
      400,
      /Control variant "red"/,
    )
  })

  it('only allows name and hypothesis changes once the experiment has started', async () => {
    await draft()
    await startExperiment(owner(), ref())

    const renamed = await updateExperiment(owner(), {
      ...ref(),
      patch: { name: 'Running test', hypothesis: 'Updated' },
    })
    expect(renamed).toMatchObject({
      name: 'Running test',
      hypothesis: 'Updated',
      status: 'running',
    })

    await expectHttpError(
      updateExperiment(owner(), {
        ...ref(),
        patch: {
          allocation: [
            { variant: 'blue', weight: 90 },
            { variant: 'green', weight: 10 },
          ],
        },
      }),
      400,
      /only be changed while the experiment is a draft.*invalidate the results/,
    )
    await expectHttpError(
      updateExperiment(owner(), { ...ref(), patch: { conversionEvent: 'other' } }),
      400,
      /draft/,
    )
    await expectHttpError(
      updateExperiment(owner(), { ...ref(), patch: { controlVariant: 'green' } }),
      400,
      /draft/,
    )
  })

  it('accepts unchanged design fields on a running experiment and skips no-op writes', async () => {
    const created = await draft()
    await startExperiment(owner(), ref())
    const before = await auditActions()
    const result = await updateExperiment(owner(), {
      ...ref(),
      patch: {
        name: created.name,
        allocation: created.allocation,
        conversionEvent: created.conversionEvent,
        controlVariant: created.controlVariant,
      },
    })
    expect(result.updatedAt).toEqual((await getExperiment(owner(), ref())).updatedAt)
    expect(await auditActions()).toEqual(before)
  })
})

describe('deleteExperiment', () => {
  it('refuses to delete a running experiment', async () => {
    await draft()
    await startExperiment(owner(), ref())
    await expectHttpError(deleteExperiment(owner(), ref()), 400, /stop it first/)
  })

  it('deletes a stopped experiment with its exposures and conversions', async () => {
    const created = await draft()
    await startExperiment(owner(), ref())
    await seedCounts(created.id, 'blue', 3, 1)
    await stopExperiment(owner(), ref())

    expect(await deleteExperiment(owner(), ref())).toEqual({ id: created.id, key: 'color-test' })
    expect(await db.select().from(experiments)).toEqual([])
    expect(await db.select().from(experimentExposures)).toEqual([])
    expect(await db.select().from(experimentConversions)).toEqual([])
    expect((await auditActions()).at(-1)).toBe('experiment.deleted')
    await expectHttpError(getExperiment(owner(), ref()), 404)
  })
})

describe('listExperiments / getExperiment', () => {
  it('lists experiments with flag, environment and counts, and filters', async () => {
    const a = await draft()
    await draft({ key: 'staging-test', environmentKey: 'staging' })
    await startExperiment(owner(), ref())
    await seedCounts(a.id, 'blue', 4, 2)
    await seedCounts(a.id, 'green', 3, 0)

    const all = await listExperiments(owner(), { projectId: projectId() })
    expect(all).toHaveLength(2)
    const running = all.find((e) => e.key === 'color-test')
    expect(running).toMatchObject({
      flagKey: 'button-color',
      flagName: 'Button color',
      environmentKey: 'production',
      status: 'running',
      counts: { exposures: 7, conversions: 2 },
    })
    expect(all.find((e) => e.key === 'staging-test')?.counts).toEqual({
      exposures: 0,
      conversions: 0,
    })

    const byStatus = await listExperiments(owner(), { projectId: projectId(), status: 'draft' })
    expect(byStatus.map((e) => e.key)).toEqual(['staging-test'])
    const byEnv = await listExperiments(owner(), {
      projectId: projectId(),
      environmentKey: 'production',
    })
    expect(byEnv.map((e) => e.key)).toEqual(['color-test'])
    const byFlag = await listExperiments(owner(), { projectId: projectId(), flagKey: 'nope' })
    expect(byFlag).toEqual([])
  })

  it('returns the flag, environment and statistics', async () => {
    const created = await draft()
    await startExperiment(owner(), ref())
    await seedCounts(created.id, 'blue', 1000, 200)
    await seedCounts(created.id, 'green', 1000, 250)

    const detail = await getExperiment(owner(), ref())
    expect(detail.flag).toMatchObject({ key: 'button-color', name: 'Button color', type: 'string' })
    expect(detail.flag.variants.map((v) => v.key)).toEqual(['blue', 'green', 'red'])
    expect(detail.environment).toEqual({
      id: fx.environmentId('production'),
      key: 'production',
      name: expect.any(String),
    })
    expect(detail.results).toEqual(
      computeResults({
        control: 'blue',
        counts: [
          { variant: 'blue', exposures: 1000, conversions: 200 },
          { variant: 'green', exposures: 1000, conversions: 250 },
        ],
        startedAt: detail.startedAt,
        stoppedAt: null,
      }),
    )
    expect(detail.results.variants[1]?.verdict).toBe('winner')
    expect(await getExperimentResults(created.id)).toEqual(detail.results)
  })

  it('reports zero counts for variants without data', async () => {
    const created = await draft()
    const results = await getExperimentResults(created.id)
    expect(results.variants.map((v) => [v.variant, v.exposures, v.conversions])).toEqual([
      ['blue', 0, 0],
      ['green', 0, 0],
    ])
    expect(results.totalExposures).toBe(0)
  })
})

describe('authorization', () => {
  it('lets viewers read but not change experiments', async () => {
    await draft()
    const viewer = fx.viewer.actor
    expect(await listExperiments(viewer, { projectId: projectId() })).toHaveLength(1)
    expect((await getExperiment(viewer, ref())).key).toBe('color-test')

    await expectHttpError(
      createExperiment(viewer, {
        projectId: projectId(),
        flagKey: 'button-color',
        environmentKey: 'production',
        key: 'viewer-test',
        name: 'Viewer',
        allocation: [
          { variant: 'blue', weight: 50 },
          { variant: 'green', weight: 50 },
        ],
        conversionEvent: 'purchase',
        controlVariant: 'blue',
      }),
      403,
    )
    await expectHttpError(startExperiment(viewer, ref()), 403)
    await expectHttpError(updateExperiment(viewer, { ...ref(), patch: { name: 'x' } }), 403)
    await expectHttpError(deleteExperiment(viewer, ref()), 403)
    const [row] = await db.select().from(experiments).where(eq(experiments.key, 'color-test'))
    expect(row?.status).toBe('draft')
  })

  it('lets editors manage the experiment lifecycle', async () => {
    const editor = fx.editor.actor
    await createExperiment(editor, {
      projectId: projectId(),
      flagKey: 'button-color',
      environmentKey: 'production',
      key: 'editor-test',
      name: 'Editor',
      allocation: [
        { variant: 'blue', weight: 50 },
        { variant: 'green', weight: 50 },
      ],
      conversionEvent: 'purchase',
      controlVariant: 'blue',
    })
    await updateExperiment(editor, { ...ref('editor-test'), patch: { name: 'Edited' } })
    await startExperiment(editor, ref('editor-test'))
    await stopExperiment(editor, ref('editor-test'))
    await deleteExperiment(editor, ref('editor-test'))
  })

  it('rejects actors of another project', async () => {
    await draft()
    const foreign = { ...fx.owner.actor, projectId: 'some-other-project' }
    await expectHttpError(listExperiments(foreign, { projectId: projectId() }), 403)
    await expectHttpError(getExperiment(foreign, ref()), 403)
  })
})
