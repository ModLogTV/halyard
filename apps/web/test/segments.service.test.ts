import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, segments } from '@/db/schema'
import { archiveFlag, createFlag, deleteFlag, updateFlagEnvironment } from '@/server/services/flags'
import {
  createSegment,
  deleteSegment,
  getSegment,
  listSegments,
  SegmentInUseError,
  updateSegment,
} from '@/server/services/segments'
import { captureEvents, createProjectFixture, type ProjectFixture } from './factories'
import { resetDatabase } from './helpers'

let fx: ProjectFixture
let events: ReturnType<typeof captureEvents>
afterEach(() => events.stop())

beforeEach(async () => {
  await resetDatabase()
  fx = await createProjectFixture()
  events = captureEvents()
})

const owner = () => fx.owner.actor
const projectId = () => fx.projectId

const betaConditions = [
  { type: 'attribute' as const, attribute: 'beta', operator: 'eq' as const, value: true },
]

const newSegment = (key = 'beta-users', extra: object = {}) =>
  createSegment(owner(), {
    projectId: projectId(),
    key,
    name: `Segment ${key}`,
    conditions: betaConditions,
    ...extra,
  })

/** Creates a flag with one rule per listed segment in the given environment. */
async function useSegment(
  flagKey: string,
  envKey: string,
  segmentKeys: string[],
  extraConditionOnFirst = false,
) {
  await createFlag(owner(), {
    projectId: projectId(),
    key: flagKey,
    name: `Flag ${flagKey}`,
    type: 'boolean',
  }).catch(() => undefined)
  await updateFlagEnvironment(owner(), {
    projectId: projectId(),
    flagKey,
    environmentKey: envKey,
    patch: {
      rules: segmentKeys.map((segmentKey, index) => ({
        id: `${flagKey}-rule-${index}`,
        conditions: [
          ...(extraConditionOnFirst && index === 0
            ? [
                {
                  type: 'attribute' as const,
                  attribute: 'plan',
                  operator: 'eq' as const,
                  value: 'pro',
                },
              ]
            : []),
          { type: 'segment' as const, segmentKey },
        ],
        serve: { type: 'variant' as const, variant: 'on' },
      })),
    },
  })
}

describe('createSegment', () => {
  it('creates a segment with defaults, audit and invalidation', async () => {
    const segment = await newSegment('beta-users', { description: 'Opted in', match: 'any' })
    expect(segment).toMatchObject({
      key: 'beta-users',
      description: 'Opted in',
      match: 'any',
      conditions: betaConditions,
    })
    const [defaulted] = [await newSegment('plain')]
    expect(defaulted.match).toBe('all')

    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'segment.created'))
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      entityType: 'segment',
      entityId: segment.id,
      entityKey: 'beta-users',
    })
    expect(entries[0]?.after).toMatchObject({ key: 'beta-users', match: 'any' })
    expect(events.events).toContainEqual({ type: 'ruleset.invalidate', projectId: projectId() })
  })

  it('validates keys and conditions with 400', async () => {
    for (const key of ['', '-x', 'a b']) {
      await expect(newSegment(key)).rejects.toMatchObject({ status: 400 })
    }
    await expect(
      createSegment(owner(), {
        projectId: projectId(),
        key: 'bad-op',
        name: 'x',
        conditions: [
          { type: 'attribute', attribute: 'a', operator: 'semver_gt', value: 'not-a-version' },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createSegment(owner(), {
        projectId: projectId(),
        key: 'nested',
        name: 'x',
        conditions: [{ type: 'segment', segmentKey: 'other' } as never],
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(await db.select().from(segments)).toHaveLength(0)
  })

  it('answers 409 for a duplicate key', async () => {
    await newSegment()
    await expect(newSegment()).rejects.toMatchObject({ status: 409 })
  })

  it('is allowed for editors and refused for viewers', async () => {
    await expect(
      createSegment(fx.editor.actor, {
        projectId: projectId(),
        key: 'e',
        name: 'E',
        conditions: betaConditions,
      }),
    ).resolves.toMatchObject({ key: 'e' })
    await expect(
      createSegment(fx.viewer.actor, {
        projectId: projectId(),
        key: 'v',
        name: 'V',
        conditions: betaConditions,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('listSegments and getSegment', () => {
  it('lists segments ordered by key with usage counts, readable by viewers', async () => {
    await newSegment('zeta')
    await newSegment('alpha')
    await useSegment('flag-a', 'development', ['alpha', 'alpha'])
    await useSegment('flag-b', 'production', ['alpha'])
    const list = await listSegments(fx.viewer.actor, { projectId: projectId() })
    expect(list.map((s) => [s.key, s.usageCount])).toEqual([
      ['alpha', 3],
      ['zeta', 0],
    ])
  })

  it('returns usages with flag, environment, rule id and index', async () => {
    await newSegment('alpha')
    await newSegment('other')
    await useSegment('flag-a', 'staging', ['other', 'alpha'], true)
    await useSegment('flag-b', 'development', ['alpha'])
    const detail = await getSegment(fx.viewer.actor, {
      projectId: projectId(),
      segmentKey: 'alpha',
    })
    expect(detail.usages).toEqual([
      {
        flagKey: 'flag-a',
        flagName: 'Flag flag-a',
        environmentKey: 'staging',
        ruleId: 'flag-a-rule-1',
        ruleIndex: 1,
      },
      {
        flagKey: 'flag-b',
        flagName: 'Flag flag-b',
        environmentKey: 'development',
        ruleId: 'flag-b-rule-0',
        ruleIndex: 0,
      },
    ])
  })

  it('counts a rule once even when it matches the segment twice, and ignores other projects', async () => {
    await newSegment('alpha')
    await createFlag(owner(), {
      projectId: projectId(),
      key: 'twice',
      name: 'Twice',
      type: 'boolean',
    })
    await updateFlagEnvironment(owner(), {
      projectId: projectId(),
      flagKey: 'twice',
      environmentKey: 'development',
      patch: {
        rules: [
          {
            id: 'dup',
            conditions: [
              { type: 'segment', segmentKey: 'alpha' },
              { type: 'segment', segmentKey: 'alpha', negate: true },
            ],
            serve: { type: 'variant', variant: 'on' },
          },
        ],
      },
    })
    const other = await createProjectFixture('other')
    await createSegment(other.owner.actor, {
      projectId: other.projectId,
      key: 'alpha',
      name: 'A',
      conditions: betaConditions,
    })
    const detail = await getSegment(owner(), { projectId: projectId(), segmentKey: 'alpha' })
    expect(detail.usages).toHaveLength(1)
    const theirs = await getSegment(other.owner.actor, {
      projectId: other.projectId,
      segmentKey: 'alpha',
    })
    expect(theirs.usages).toEqual([])
  })

  it('404s for unknown segments', async () => {
    await expect(
      getSegment(owner(), { projectId: projectId(), segmentKey: 'nope' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('updateSegment', () => {
  it('updates fields with before/after audit and invalidation', async () => {
    await newSegment()
    events.events.length = 0
    const updated = await updateSegment(fx.editor.actor, {
      projectId: projectId(),
      segmentKey: 'beta-users',
      patch: {
        name: 'Beta',
        match: 'any',
        conditions: [
          { type: 'attribute', attribute: 'country', operator: 'in', value: ['DE', 'AT'] },
        ],
      },
    })
    expect(updated).toMatchObject({ name: 'Beta', match: 'any' })
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'segment.updated'))
    expect(entry?.before).toMatchObject({
      name: 'Segment beta-users',
      match: 'all',
      conditions: betaConditions,
    })
    expect(entry?.after).toMatchObject({ name: 'Beta', match: 'any' })
    expect(events.events).toEqual([{ type: 'ruleset.invalidate', projectId: projectId() }])
  })

  it('validates the new conditions and skips no-ops', async () => {
    await newSegment()
    await expect(
      updateSegment(owner(), {
        projectId: projectId(),
        segmentKey: 'beta-users',
        patch: { conditions: [{ type: 'attribute', attribute: '', operator: 'eq', value: 1 }] },
      }),
    ).rejects.toMatchObject({ status: 400 })
    await updateSegment(owner(), {
      projectId: projectId(),
      segmentKey: 'beta-users',
      patch: { match: 'all' },
    })
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, 'segment.updated')),
    ).toHaveLength(0)
  })

  it('refuses viewers and 404s for unknown segments', async () => {
    await newSegment()
    await expect(
      updateSegment(fx.viewer.actor, {
        projectId: projectId(),
        segmentKey: 'beta-users',
        patch: { name: 'x' },
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      updateSegment(owner(), { projectId: projectId(), segmentKey: 'nope', patch: { name: 'x' } }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('deleteSegment', () => {
  it('deletes an unused segment with audit and invalidation', async () => {
    const segment = await newSegment()
    events.events.length = 0
    await deleteSegment(fx.editor.actor, { projectId: projectId(), segmentKey: 'beta-users' })
    expect(await db.select().from(segments)).toHaveLength(0)
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'segment.deleted'))
    expect(entry).toMatchObject({ entityId: segment.id, entityKey: 'beta-users' })
    expect(entry?.before).toMatchObject({ key: 'beta-users' })
    expect(events.events).toEqual([{ type: 'ruleset.invalidate', projectId: projectId() }])
  })

  it('is blocked with 409 SEGMENT_IN_USE and lists the usages while a rule references it', async () => {
    await newSegment()
    await useSegment('checkout', 'production', ['beta-users'])
    const error = await deleteSegment(owner(), {
      projectId: projectId(),
      segmentKey: 'beta-users',
    }).catch((e) => e)
    expect(error).toBeInstanceOf(SegmentInUseError)
    expect(error).toMatchObject({ status: 409, code: 'SEGMENT_IN_USE' })
    expect(error.usages).toEqual([
      {
        flagKey: 'checkout',
        flagName: 'Flag checkout',
        environmentKey: 'production',
        ruleId: 'checkout-rule-0',
        ruleIndex: 0,
      },
    ])
    const body = await error.toResponse().json()
    expect(body).toMatchObject({ error: 'SEGMENT_IN_USE', usages: error.usages })
    expect(await db.select().from(segments)).toHaveLength(1)
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, 'segment.deleted')),
    ).toHaveLength(0)
  })

  it('is blocked by archived flags too, and possible again once the rule is gone', async () => {
    await newSegment()
    await useSegment('checkout', 'production', ['beta-users'])
    await archiveFlag(owner(), { projectId: projectId(), flagKey: 'checkout' })
    await expect(
      deleteSegment(owner(), { projectId: projectId(), segmentKey: 'beta-users' }),
    ).rejects.toMatchObject({ status: 409, code: 'SEGMENT_IN_USE' })

    await updateFlagEnvironment(owner(), {
      projectId: projectId(),
      flagKey: 'checkout',
      environmentKey: 'production',
      patch: { rules: [] },
    })
    await expect(
      deleteSegment(owner(), { projectId: projectId(), segmentKey: 'beta-users' }),
    ).resolves.toBeDefined()
  })

  it('is possible after the referencing flag is deleted', async () => {
    await newSegment()
    await useSegment('checkout', 'staging', ['beta-users'])
    await deleteFlag(owner(), { projectId: projectId(), flagKey: 'checkout' })
    await expect(
      deleteSegment(owner(), { projectId: projectId(), segmentKey: 'beta-users' }),
    ).resolves.toBeDefined()
  })

  it('refuses viewers and 404s for unknown segments', async () => {
    await newSegment()
    await expect(
      deleteSegment(fx.viewer.actor, { projectId: projectId(), segmentKey: 'beta-users' }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      deleteSegment(owner(), { projectId: projectId(), segmentKey: 'nope' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
