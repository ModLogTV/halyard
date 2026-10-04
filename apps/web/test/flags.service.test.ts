import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, experiments, flagEnvironments, flagEvaluationStats, flags } from '@/db/schema'
import {
  archiveFlag,
  copyFlagEnvironment,
  createFlag,
  deleteFlag,
  getFlag,
  listFlags,
  permissionsForEnvironmentPatch,
  toggleFlag,
  unarchiveFlag,
  updateFlag,
  updateFlagEnvironment,
} from '@/server/services/flags'
import { createSegment } from '@/server/services/segments'
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

const auditActions = async () =>
  (await db.select().from(auditLog).orderBy(auditLog.createdAt)).map((a) => a.action)

async function configOf(flagKey: string, envKey: string) {
  const detail = await getFlag(owner(), { projectId: projectId(), flagKey })
  const config = detail.environments.find((e) => e.environmentKey === envKey)
  if (!config) throw new Error('missing environment')
  return config
}

describe('createFlag', () => {
  it('creates a boolean flag with on/off variants and a disabled config per environment', async () => {
    const flag = await newBoolean()
    expect(flag).toMatchObject({
      key: 'checkout',
      type: 'boolean',
      archivedAt: null,
      createdBy: fx.owner.user.id,
    })
    expect(flag.variants).toEqual([
      { key: 'on', value: true, name: 'On' },
      { key: 'off', value: false, name: 'Off' },
    ])

    const detail = await getFlag(owner(), { projectId: projectId(), flagKey: 'checkout' })
    expect(detail.environments.map((e) => e.environmentKey)).toEqual([
      'development',
      'staging',
      'production',
    ])
    for (const env of detail.environments) {
      expect(env).toMatchObject({
        enabled: false,
        offVariant: 'off',
        fallthrough: { type: 'variant', variant: 'on' },
        rules: [],
        version: 1,
        hasRunningExperiment: false,
      })
    }
  })

  it('uses the last variant as off variant and the first other variant as fallthrough for non-boolean flags', async () => {
    await newPlan()
    const config = await configOf('plan', 'development')
    expect(config.offVariant).toBe('team')
    expect(config.fallthrough).toEqual({ type: 'variant', variant: 'free' })
  })

  it('serves the off variant when it is the only variant', async () => {
    await createFlag(owner(), {
      projectId: projectId(),
      key: 'limit',
      name: 'Limit',
      type: 'number',
      variants: [{ key: 'only', value: 5 }],
    })
    const config = await configOf('limit', 'staging')
    expect(config).toMatchObject({
      offVariant: 'only',
      fallthrough: { type: 'variant', variant: 'only' },
    })
  })

  it('honours explicit offVariant and defaultVariant', async () => {
    await createFlag(owner(), {
      projectId: projectId(),
      key: 'plan',
      name: 'Plan',
      type: 'string',
      variants: [
        { key: 'free', value: 'free' },
        { key: 'pro', value: 'pro' },
      ],
      offVariant: 'pro',
      defaultVariant: 'pro',
    })
    const config = await configOf('plan', 'production')
    expect(config).toMatchObject({
      offVariant: 'pro',
      fallthrough: { type: 'variant', variant: 'pro' },
    })
    await expect(
      createFlag(owner(), {
        projectId: projectId(),
        key: 'bad',
        name: 'Bad',
        type: 'boolean',
        offVariant: 'nope',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('supports json flags with structured values', async () => {
    const flag = await createFlag(owner(), {
      projectId: projectId(),
      key: 'layout',
      name: 'Layout',
      type: 'json',
      variants: [
        { key: 'a', value: { columns: 2, tags: ['x'] } },
        { key: 'b', value: null },
      ],
      tags: ['ui', 'ui', ' web '],
    })
    expect(flag.variants[0]?.value).toEqual({ columns: 2, tags: ['x'] })
    expect(flag.tags).toEqual(['ui', 'web'])
  })

  it('rejects invalid keys, duplicate variant keys and mistyped values with 400', async () => {
    const base = { projectId: projectId(), name: 'x', type: 'boolean' as const }
    for (const key of ['', '-a', 'a b', 'a/b']) {
      await expect(createFlag(owner(), { ...base, key })).rejects.toMatchObject({ status: 400 })
    }
    await expect(
      createFlag(owner(), {
        ...base,
        key: 'dup',
        type: 'string',
        variants: [
          { key: 'a', value: 'a' },
          { key: 'a', value: 'b' },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createFlag(owner(), {
        ...base,
        key: 'mistyped',
        type: 'number',
        variants: [{ key: 'a', value: 'not a number' }],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createFlag(owner(), { ...base, key: 'novariants', type: 'string' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(await db.select().from(flags)).toHaveLength(0)
  })

  it('answers 409 for a duplicate key, but allows the key in another project', async () => {
    await newBoolean('same')
    await expect(newBoolean('same')).rejects.toMatchObject({ status: 409 })
    const other = await createProjectFixture('other')
    await expect(
      createFlag(other.owner.actor, {
        projectId: other.projectId,
        key: 'same',
        name: 'x',
        type: 'boolean',
      }),
    ).resolves.toMatchObject({ key: 'same' })
  })

  it('writes an audit entry and invalidates the project rulesets', async () => {
    const flag = await newBoolean()
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'flag.created'))
    expect(entry).toMatchObject({
      entityType: 'flag',
      entityId: flag.id,
      entityKey: 'checkout',
      actorId: fx.owner.user.id,
      before: null,
    })
    expect(entry?.after).toMatchObject({ key: 'checkout', type: 'boolean' })
    expect(events.events).toContainEqual({ type: 'ruleset.invalidate', projectId: projectId() })
  })

  it('is allowed for editors, refused for viewers and outsiders', async () => {
    await expect(
      createFlag(fx.editor.actor, { projectId: projectId(), key: 'e', name: 'E', type: 'boolean' }),
    ).resolves.toMatchObject({ key: 'e' })
    await expect(
      createFlag(fx.viewer.actor, { projectId: projectId(), key: 'v', name: 'V', type: 'boolean' }),
    ).rejects.toMatchObject({ status: 403 })
    const other = await createProjectFixture('other')
    await expect(
      createFlag(other.owner.actor, {
        projectId: projectId(),
        key: 'o',
        name: 'O',
        type: 'boolean',
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('listFlags', () => {
  it('returns flags ordered by key with environment summaries and stats', async () => {
    await newBoolean('zeta')
    const alpha = await newBoolean('alpha')
    const devId = fx.environmentId('development')
    await updateFlagEnvironment(owner(), {
      projectId: projectId(),
      flagKey: 'alpha',
      environmentKey: 'development',
      patch: {
        enabled: true,
        rules: [
          {
            conditions: [{ type: 'attribute', attribute: 'plan', operator: 'eq', value: 'pro' }],
            serve: { type: 'variant', variant: 'on' },
          },
        ],
      },
    })
    const now = new Date()
    await db.insert(flagEvaluationStats).values({
      flagId: alpha.id,
      environmentId: devId,
      lastEvaluatedAt: now,
      lastVariant: 'on',
      sameVariantSince: now,
      evaluationCount: 42,
    })

    const list = await listFlags(fx.viewer.actor, { projectId: projectId() })
    expect(list.map((f) => f.key)).toEqual(['alpha', 'zeta'])
    const first = list[0]
    expect(first?.environments.map((e) => e.environmentKey)).toEqual([
      'development',
      'staging',
      'production',
    ])
    expect(first?.environments[0]).toMatchObject({
      environmentId: devId,
      enabled: true,
      ruleCount: 1,
      version: 2,
      fallthrough: { type: 'variant', variant: 'on' },
    })
    expect(first?.environments[1]).toMatchObject({ enabled: false, ruleCount: 0, version: 1 })
    expect(first?.stats).toEqual([
      {
        environmentId: devId,
        lastEvaluatedAt: now,
        lastVariant: 'on',
        sameVariantSince: now,
        evaluationCount: 42,
      },
    ])
    expect(list[1]?.stats).toEqual([])
  })

  it('filters by search, tags, type and archived state', async () => {
    await createFlag(owner(), {
      projectId: projectId(),
      key: 'new-checkout',
      name: 'Checkout redesign',
      type: 'boolean',
      tags: ['ui'],
    })
    await createFlag(owner(), {
      projectId: projectId(),
      key: 'search_v2',
      name: 'Search',
      type: 'boolean',
      tags: ['backend'],
    })
    await createFlag(owner(), {
      projectId: projectId(),
      key: 'banner',
      name: 'Banner text',
      type: 'string',
      variants: [{ key: 'a', value: 'a' }],
      tags: ['ui', 'backend'],
    })
    await archiveFlag(owner(), { projectId: projectId(), flagKey: 'search_v2' })

    const keys = async (input: object) =>
      (await listFlags(owner(), { projectId: projectId(), ...input })).map((f) => f.key)

    expect(await keys({})).toEqual(['banner', 'new-checkout'])
    expect(await keys({ includeArchived: true })).toEqual(['banner', 'new-checkout', 'search_v2'])
    expect(await keys({ search: 'CHECK' })).toEqual(['new-checkout'])
    expect(await keys({ search: 'text' })).toEqual(['banner'])
    expect(await keys({ search: '_v', includeArchived: true })).toEqual(['search_v2'])
    expect(await keys({ search: '%' })).toEqual([])
    expect(await keys({ tags: ['ui'] })).toEqual(['banner', 'new-checkout'])
    expect(await keys({ tags: ['backend'], includeArchived: true })).toEqual([
      'banner',
      'search_v2',
    ])
    expect(await keys({ type: 'string' })).toEqual(['banner'])
  })

  it('is scoped to the project and needs read permission', async () => {
    await newBoolean()
    const other = await createProjectFixture('other')
    expect(await listFlags(other.owner.actor, { projectId: other.projectId })).toEqual([])
    await expect(listFlags(other.owner.actor, { projectId: projectId() })).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('getFlag', () => {
  it('returns full configs, stats and running experiments per environment', async () => {
    const flag = await newBoolean()
    const stagingId = fx.environmentId('staging')
    await db.insert(experiments).values([
      {
        projectId: projectId(),
        flagId: flag.id,
        environmentId: stagingId,
        key: 'exp-1',
        name: 'Exp',
        status: 'running',
        allocation: [
          { variant: 'on', weight: 50 },
          { variant: 'off', weight: 50 },
        ],
        conversionEvent: 'purchase',
        controlVariant: 'off',
      },
      {
        projectId: projectId(),
        flagId: flag.id,
        environmentId: fx.environmentId('production'),
        key: 'exp-2',
        name: 'Stopped',
        status: 'stopped',
        allocation: [{ variant: 'on', weight: 100 }],
        conversionEvent: 'purchase',
        controlVariant: 'off',
      },
    ])
    const detail = await getFlag(fx.viewer.actor, { projectId: projectId(), flagKey: 'checkout' })
    expect(detail.environments.map((e) => [e.environmentKey, e.hasRunningExperiment])).toEqual([
      ['development', false],
      ['staging', true],
      ['production', false],
    ])
    expect(detail.stats).toEqual([])
  })

  it('404s for unknown flags and flags of other projects', async () => {
    await expect(
      getFlag(owner(), { projectId: projectId(), flagKey: 'nope' }),
    ).rejects.toMatchObject({ status: 404 })
    const other = await createProjectFixture('other')
    await createFlag(other.owner.actor, {
      projectId: other.projectId,
      key: 'theirs',
      name: 'T',
      type: 'boolean',
    })
    await expect(
      getFlag(owner(), { projectId: projectId(), flagKey: 'theirs' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('updateFlag', () => {
  it('updates name, description and tags with before/after audit and invalidation', async () => {
    await newBoolean()
    events.events.length = 0
    const updated = await updateFlag(fx.editor.actor, {
      projectId: projectId(),
      flagKey: 'checkout',
      patch: { name: 'Checkout v2', description: 'The new checkout', tags: ['payments'] },
    })
    expect(updated).toMatchObject({
      name: 'Checkout v2',
      description: 'The new checkout',
      tags: ['payments'],
    })

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'flag.updated'))
    expect(entry?.actorName).toBe('Eddie Editor')
    expect(entry?.before).toMatchObject({ name: 'Flag checkout', description: null, tags: [] })
    expect(entry?.after).toMatchObject({
      name: 'Checkout v2',
      description: 'The new checkout',
      tags: ['payments'],
    })
    expect(events.events).toEqual([{ type: 'ruleset.invalidate', projectId: projectId() }])
  })

  it('does nothing when nothing changes', async () => {
    const flag = await newBoolean()
    await updateFlag(owner(), {
      projectId: projectId(),
      flagKey: 'checkout',
      patch: { name: flag.name },
    })
    expect(await auditActions()).toEqual(['project.created', 'flag.created'])
  })

  it('allows changing variant values, adding variants and removing unused ones', async () => {
    await newPlan()
    const updated = await updateFlag(owner(), {
      projectId: projectId(),
      flagKey: 'plan',
      patch: {
        variants: [
          { key: 'free', value: 'FREE' },
          { key: 'pro', value: 'pro' },
          { key: 'enterprise', value: 'enterprise' },
          { key: 'team', value: 'team' },
        ],
      },
    })
    expect(updated.variants.map((v) => v.key)).toEqual(['free', 'pro', 'enterprise', 'team'])

    // "pro" is not referenced by anything (off = team, fallthrough = free).
    const removed = await updateFlag(owner(), {
      projectId: projectId(),
      flagKey: 'plan',
      patch: {
        variants: [
          { key: 'free', value: 'free' },
          { key: 'enterprise', value: 'enterprise' },
          { key: 'team', value: 'team' },
        ],
      },
    })
    expect(removed.variants.map((v) => v.key)).toEqual(['free', 'enterprise', 'team'])
  })

  describe('removing referenced variants', () => {
    const without = (...keys: string[]) =>
      ['free', 'pro', 'team'].filter((k) => !keys.includes(k)).map((k) => ({ key: k, value: k }))
    const attempt = (keys: string[]) =>
      updateFlag(owner(), {
        projectId: projectId(),
        flagKey: 'plan',
        patch: { variants: without(...keys) },
      })

    beforeEach(async () => {
      await newPlan()
    })

    it('blocks the off variant', async () => {
      await expect(attempt(['team'])).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('off variant'),
      })
    })

    it('blocks the fallthrough variant', async () => {
      await expect(attempt(['free'])).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('fallthrough'),
      })
    })

    it('blocks a variant served by a rule in any environment', async () => {
      await updateFlagEnvironment(owner(), {
        projectId: projectId(),
        flagKey: 'plan',
        environmentKey: 'staging',
        patch: {
          rules: [{ conditions: [], serve: { type: 'variant', variant: 'pro' } }],
        },
      })
      await expect(attempt(['pro'])).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/rule 1.*staging/),
      })
    })

    it('blocks a variant used in a rollout', async () => {
      await updateFlagEnvironment(owner(), {
        projectId: projectId(),
        flagKey: 'plan',
        environmentKey: 'production',
        patch: {
          fallthrough: {
            type: 'rollout',
            variations: [
              { variant: 'free', weight: 90 },
              { variant: 'pro', weight: 10 },
            ],
          },
        },
      })
      await expect(attempt(['pro'])).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('production'),
      })
    })

    it('treats a renamed variant key as a removal', async () => {
      await expect(
        updateFlag(owner(), {
          projectId: projectId(),
          flagKey: 'plan',
          patch: {
            variants: [
              { key: 'gratis', value: 'free' },
              { key: 'pro', value: 'pro' },
              { key: 'team', value: 'team' },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('blocks a variant used by a running experiment but not by a stopped one', async () => {
      const flag = await getFlag(owner(), { projectId: projectId(), flagKey: 'plan' })
      const experiment = (status: 'running' | 'stopped', key: string) => ({
        projectId: projectId(),
        flagId: flag.id,
        environmentId: fx.environmentId('development'),
        key,
        name: key,
        status,
        allocation: [
          { variant: 'free', weight: 50 },
          { variant: 'pro', weight: 50 },
        ],
        conversionEvent: 'upgrade',
        controlVariant: 'free',
      })
      await db.insert(experiments).values(experiment('stopped', 'old'))
      await expect(attempt(['pro'])).resolves.toMatchObject({ key: 'plan' })

      await updateFlag(owner(), {
        projectId: projectId(),
        flagKey: 'plan',
        patch: { variants: without() },
      })
      await db.insert(experiments).values(experiment('running', 'live'))
      await expect(attempt(['pro'])).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('running experiment "live"'),
      })
    })

    it('rejects values that do not match the flag type', async () => {
      await expect(
        updateFlag(owner(), {
          projectId: projectId(),
          flagKey: 'plan',
          patch: {
            variants: [
              { key: 'free', value: 1 },
              { key: 'pro', value: 'pro' },
              { key: 'team', value: 'team' },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  it('refuses viewers', async () => {
    await newBoolean()
    await expect(
      updateFlag(fx.viewer.actor, {
        projectId: projectId(),
        flagKey: 'checkout',
        patch: { name: 'x' },
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('archive, unarchive and delete', () => {
  it('archives and unarchives with audit entries and invalidation', async () => {
    await newBoolean()
    const archived = await archiveFlag(fx.editor.actor, {
      projectId: projectId(),
      flagKey: 'checkout',
    })
    expect(archived.archivedAt).toBeInstanceOf(Date)
    const restored = await unarchiveFlag(fx.editor.actor, {
      projectId: projectId(),
      flagKey: 'checkout',
    })
    expect(restored.archivedAt).toBeNull()
    expect(await auditActions()).toEqual([
      'project.created',
      'flag.created',
      'flag.archived',
      'flag.unarchived',
    ])
    expect(events.events.filter((e) => e.type === 'ruleset.invalidate')).toHaveLength(3)
  })

  it('is idempotent', async () => {
    await newBoolean()
    await archiveFlag(owner(), { projectId: projectId(), flagKey: 'checkout' })
    await archiveFlag(owner(), { projectId: projectId(), flagKey: 'checkout' })
    expect((await auditActions()).filter((a) => a === 'flag.archived')).toHaveLength(1)
  })

  it('deletes a flag with cascade and audit', async () => {
    const flag = await newBoolean()
    await deleteFlag(fx.editor.actor, { projectId: projectId(), flagKey: 'checkout' })
    expect(await db.select().from(flags)).toHaveLength(0)
    expect(
      await db.select().from(flagEnvironments).where(eq(flagEnvironments.flagId, flag.id)),
    ).toHaveLength(0)
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'flag.deleted'))
    expect(entry).toMatchObject({ entityId: flag.id, entityKey: 'checkout' })
    expect(entry?.before).toMatchObject({ key: 'checkout' })
    await expect(
      deleteFlag(owner(), { projectId: projectId(), flagKey: 'checkout' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses viewers for all three', async () => {
    await newBoolean()
    const ref = { projectId: projectId(), flagKey: 'checkout' }
    await expect(archiveFlag(fx.viewer.actor, ref)).rejects.toMatchObject({ status: 403 })
    await expect(unarchiveFlag(fx.viewer.actor, ref)).rejects.toMatchObject({ status: 403 })
    await expect(deleteFlag(fx.viewer.actor, ref)).rejects.toMatchObject({ status: 403 })
    expect(await db.select().from(flags)).toHaveLength(1)
  })
})

describe('updateFlagEnvironment', () => {
  const ref = () => ({ projectId: projectId(), flagKey: 'checkout', environmentKey: 'production' })

  beforeEach(async () => {
    await newBoolean()
    events.events.length = 0
  })

  it('merges the patch over the current config, assigns rule ids and bumps the version', async () => {
    const result = await updateFlagEnvironment(owner(), {
      ...ref(),
      patch: {
        enabled: true,
        rules: [
          {
            description: 'Internal users',
            conditions: [
              { type: 'attribute', attribute: 'email', operator: 'ends_with', value: '@acme.test' },
            ],
            serve: { type: 'variant', variant: 'on' },
          },
          { id: 'keep-me', conditions: [], serve: { type: 'variant', variant: 'off' } },
        ],
      },
    })
    expect(result).toMatchObject({
      flagKey: 'checkout',
      environmentKey: 'production',
      enabled: true,
      offVariant: 'off',
      fallthrough: { type: 'variant', variant: 'on' },
      version: 2,
    })
    expect(result.rules[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.rules[1]?.id).toBe('keep-me')

    // Other environments are untouched.
    expect((await configOf('checkout', 'staging')).version).toBe(1)

    const again = await updateFlagEnvironment(owner(), {
      ...ref(),
      patch: { fallthrough: { type: 'variant', variant: 'off' } },
    })
    expect(again).toMatchObject({ version: 3, enabled: true })
    expect(again.rules).toHaveLength(2)
    expect(again.rules[0]?.id).toBe(result.rules[0]?.id)
  })

  it('writes flag.environment_updated with full before/after configs and invalidates only that environment', async () => {
    await updateFlagEnvironment(owner(), {
      ...ref(),
      patch: { enabled: true, fallthrough: { type: 'variant', variant: 'off' } },
    })
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'flag.environment_updated'))
    expect(entry).toMatchObject({
      entityType: 'flag',
      entityKey: 'checkout',
      environmentId: fx.environmentId('production'),
      actorId: fx.owner.user.id,
    })
    expect(entry?.before).toEqual({
      enabled: false,
      offVariant: 'off',
      fallthrough: { type: 'variant', variant: 'on' },
      rules: [],
    })
    expect(entry?.after).toEqual({
      enabled: true,
      offVariant: 'off',
      fallthrough: { type: 'variant', variant: 'off' },
      rules: [],
    })
    expect(events.events).toEqual([
      {
        type: 'ruleset.invalidate',
        projectId: projectId(),
        environmentId: fx.environmentId('production'),
      },
    ])
  })

  it('writes flag.toggled when only enabled changed', async () => {
    await toggleFlag(owner(), { ...ref(), enabled: true })
    await toggleFlag(owner(), { ...ref(), enabled: false })
    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'flag.toggled'))
      .orderBy(auditLog.createdAt)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.before).toMatchObject({ enabled: false })
    expect(entries[0]?.after).toMatchObject({ enabled: true })
    expect(entries[1]?.after).toMatchObject({ enabled: false })
    expect((await configOf('checkout', 'production')).version).toBe(3)
  })

  it('treats a no-op as a no-op', async () => {
    const result = await updateFlagEnvironment(owner(), { ...ref(), patch: { enabled: false } })
    expect(result.version).toBe(1)
    expect(await auditActions()).toEqual(['project.created', 'flag.created'])
    expect(events.events).toEqual([])
  })

  it('rejects an empty patch and unknown flags or environments', async () => {
    await expect(updateFlagEnvironment(owner(), { ...ref(), patch: {} })).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      updateFlagEnvironment(owner(), { ...ref(), flagKey: 'nope', patch: { enabled: true } }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      updateFlagEnvironment(owner(), {
        ...ref(),
        environmentKey: 'nope',
        patch: { enabled: true },
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  describe('optimistic concurrency', () => {
    it('accepts the current version and rejects a stale one with 409', async () => {
      await updateFlagEnvironment(owner(), {
        ...ref(),
        patch: { enabled: true },
        expectedVersion: 1,
      })
      await expect(
        updateFlagEnvironment(owner(), { ...ref(), patch: { enabled: false }, expectedVersion: 1 }),
      ).rejects.toMatchObject({ status: 409 })
      expect((await configOf('checkout', 'production')).enabled).toBe(true)
      await expect(
        updateFlagEnvironment(owner(), { ...ref(), patch: { enabled: false }, expectedVersion: 2 }),
      ).resolves.toMatchObject({ enabled: false, version: 3 })
    })

    it('lets exactly one of two racing writers with the same version win', async () => {
      const results = await Promise.allSettled([
        updateFlagEnvironment(owner(), {
          ...ref(),
          patch: { fallthrough: { type: 'variant', variant: 'off' } },
          expectedVersion: 1,
        }),
        updateFlagEnvironment(fx.editor.actor, {
          ...ref(),
          patch: { enabled: true },
          expectedVersion: 1,
        }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((r) => r.status === 'rejected')
      expect(rejected).toMatchObject({ reason: { status: 409 } })
      expect((await configOf('checkout', 'production')).version).toBe(2)
    })
  })

  describe('validation', () => {
    it('rejects unknown variants, bad rollout weights and unknown segments with 400', async () => {
      await expect(
        updateFlagEnvironment(owner(), { ...ref(), patch: { offVariant: 'ghost' } }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updateFlagEnvironment(owner(), {
          ...ref(),
          patch: {
            fallthrough: {
              type: 'rollout',
              variations: [
                { variant: 'on', weight: 60 },
                { variant: 'off', weight: 60 },
              ],
            },
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        updateFlagEnvironment(owner(), {
          ...ref(),
          patch: {
            rules: [
              {
                conditions: [{ type: 'segment', segmentKey: 'ghosts' }],
                serve: { type: 'variant', variant: 'on' },
              },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('ghosts') })
      expect((await configOf('checkout', 'production')).version).toBe(1)
    })

    it('accepts rules that reference existing segments', async () => {
      await createSegment(owner(), {
        projectId: projectId(),
        key: 'beta-testers',
        name: 'Beta testers',
        conditions: [{ type: 'attribute', attribute: 'beta', operator: 'eq', value: true }],
      })
      const result = await updateFlagEnvironment(owner(), {
        ...ref(),
        patch: {
          rules: [
            {
              conditions: [{ type: 'segment', segmentKey: 'beta-testers' }],
              serve: { type: 'variant', variant: 'on' },
            },
          ],
        },
      })
      expect(result.rules).toHaveLength(1)
    })

    it('rejects structurally invalid input', async () => {
      await expect(
        updateFlagEnvironment(owner(), {
          ...ref(),
          patch: {
            rules: [
              {
                conditions: [{ type: 'attribute', attribute: 'a', operator: 'bogus' as never }],
                serve: { type: 'variant', variant: 'on' },
              },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('authorization', () => {
    it('lets viewers do neither toggle nor update', async () => {
      await expect(
        updateFlagEnvironment(fx.viewer.actor, { ...ref(), patch: { enabled: true } }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(toggleFlag(fx.viewer.actor, { ...ref(), enabled: true })).rejects.toMatchObject({
        status: 403,
      })
      await expect(
        updateFlagEnvironment(fx.viewer.actor, {
          ...ref(),
          patch: { fallthrough: { type: 'variant', variant: 'off' } },
        }),
      ).rejects.toMatchObject({ status: 403 })
      expect((await configOf('checkout', 'production')).enabled).toBe(false)
      expect(await auditActions()).toEqual(['project.created', 'flag.created'])
    })

    it('lets editors toggle and update', async () => {
      await expect(toggleFlag(fx.editor.actor, { ...ref(), enabled: true })).resolves.toMatchObject(
        { enabled: true },
      )
      await expect(
        updateFlagEnvironment(fx.editor.actor, {
          ...ref(),
          patch: { fallthrough: { type: 'variant', variant: 'off' } },
        }),
      ).resolves.toMatchObject({ version: 3 })
    })

    it('requires update permission once anything beyond enabled is in the patch', async () => {
      expect(permissionsForEnvironmentPatch({ enabled: true })).toEqual({ flag: ['toggle'] })
      expect(permissionsForEnvironmentPatch({ enabled: true, rules: [] })).toEqual({
        flag: ['update'],
      })
      expect(permissionsForEnvironmentPatch({ enabled: undefined, offVariant: 'off' })).toEqual({
        flag: ['update'],
      })
    })
  })
})

describe('copyFlagEnvironment', () => {
  const copy = (extra: object = {}, actor = owner()) =>
    copyFlagEnvironment(actor, {
      projectId: projectId(),
      flagKey: 'plan',
      fromEnvironmentKey: 'staging',
      toEnvironmentKey: 'production',
      ...extra,
    })

  beforeEach(async () => {
    await newPlan()
    await updateFlagEnvironment(owner(), {
      projectId: projectId(),
      flagKey: 'plan',
      environmentKey: 'staging',
      patch: {
        enabled: true,
        offVariant: 'free',
        fallthrough: { type: 'variant', variant: 'pro' },
        rules: [
          {
            id: 'r1',
            conditions: [
              { type: 'attribute', attribute: 'country', operator: 'in', value: ['DE', 'AT'] },
            ],
            serve: { type: 'variant', variant: 'team' },
          },
        ],
      },
    })
    events.events.length = 0
  })

  it('copies every field by default and returns before and after', async () => {
    const result = await copy()
    expect(result.changed).toBe(true)
    expect(result.version).toBe(2)
    expect(result.before).toEqual({
      enabled: false,
      offVariant: 'team',
      fallthrough: { type: 'variant', variant: 'free' },
      rules: [],
    })
    expect(result.after).toMatchObject({
      enabled: true,
      offVariant: 'free',
      fallthrough: { type: 'variant', variant: 'pro' },
    })
    expect(result.after.rules).toHaveLength(1)
    expect(await configOf('plan', 'production')).toMatchObject({
      enabled: true,
      version: 2,
      offVariant: 'free',
    })

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'flag.promoted'))
    expect(entry).toMatchObject({
      environmentId: fx.environmentId('production'),
      entityKey: 'plan',
    })
    expect(entry?.before).toEqual(result.before)
    expect(entry?.after).toEqual(result.after)
    expect(events.events).toEqual([
      {
        type: 'ruleset.invalidate',
        projectId: projectId(),
        environmentId: fx.environmentId('production'),
      },
    ])
  })

  it('copies only the selected fields', async () => {
    await copy({ fields: ['rules', 'fallthrough'] })
    const target = await configOf('plan', 'production')
    expect(target.enabled).toBe(false)
    expect(target.offVariant).toBe('team')
    expect(target.fallthrough).toEqual({ type: 'variant', variant: 'pro' })
    expect(target.rules).toHaveLength(1)
  })

  it('does not write anything when the target already matches', async () => {
    await copy()
    const second = await copy()
    expect(second).toMatchObject({ changed: false, version: 2 })
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, 'flag.promoted')),
    ).toHaveLength(1)
  })

  it('rejects identical environments and unknown ones', async () => {
    await expect(copy({ toEnvironmentKey: 'staging' })).rejects.toMatchObject({ status: 400 })
    await expect(copy({ toEnvironmentKey: 'nope' })).rejects.toMatchObject({ status: 404 })
    await expect(copy({ fields: [] })).rejects.toMatchObject({ status: 400 })
  })

  it('requires the promote permission', async () => {
    await expect(copy({}, fx.viewer.actor)).rejects.toMatchObject({ status: 403 })
    await expect(copy({}, fx.editor.actor)).resolves.toMatchObject({ changed: true })
  })

  it('leaves the source untouched', async () => {
    await copy()
    const source = await db
      .select()
      .from(flagEnvironments)
      .where(and(eq(flagEnvironments.environmentId, fx.environmentId('staging'))))
    expect(source[0]).toMatchObject({ version: 2, enabled: true })
  })
})
