import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, environments, flagEnvironments } from '@/db/schema'
import {
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  reorderEnvironments,
  updateEnvironment,
} from '@/server/services/environments'
import { createFlag } from '@/server/services/flags'
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

describe('createEnvironment', () => {
  it('appends an environment with defaults and records audit and invalidation', async () => {
    const env = await createEnvironment(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'qa_1',
      name: 'QA',
    })
    expect(env).toMatchObject({
      key: 'qa_1',
      name: 'QA',
      color: '#64748b',
      isProduction: false,
      sortOrder: 3,
    })

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'environment.created'))
    expect(entry).toMatchObject({
      environmentId: env.id,
      entityKey: 'qa_1',
      actorName: 'Olivia Owner',
    })
    expect(entry?.after).toMatchObject({ key: 'qa_1', name: 'QA' })
    expect(events.events).toContainEqual({ type: 'ruleset.invalidate', projectId: fx.projectId })
  })

  it('creates a disabled configuration for every existing flag, copied from the flag defaults', async () => {
    await createFlag(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'checkout',
      name: 'Checkout',
      type: 'boolean',
    })
    await createFlag(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'theme',
      name: 'Theme',
      type: 'string',
      variants: [
        { key: 'light', value: 'light' },
        { key: 'dark', value: 'dark' },
      ],
    })

    const env = await createEnvironment(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'qa',
      name: 'QA',
      color: '#10b981',
      isProduction: true,
    })
    expect(env.color).toBe('#10b981')
    expect(env.isProduction).toBe(true)

    const configs = await db
      .select()
      .from(flagEnvironments)
      .where(eq(flagEnvironments.environmentId, env.id))
    expect(configs).toHaveLength(2)
    expect(configs.every((c) => !c.enabled && c.rules.length === 0 && c.version === 1)).toBe(true)
    expect(configs.map((c) => [c.offVariant, c.fallthrough]).sort()).toEqual([
      ['dark', { type: 'variant', variant: 'light' }],
      ['off', { type: 'variant', variant: 'on' }],
    ])
  })

  it('validates key and color', async () => {
    for (const key of ['Prod', '-x', 'a b', '', '_a']) {
      await expect(
        createEnvironment(fx.owner.actor, { projectId: fx.projectId, key, name: 'x' }),
      ).rejects.toMatchObject({ status: 400 })
    }
    await expect(
      createEnvironment(fx.owner.actor, {
        projectId: fx.projectId,
        key: 'ok',
        name: 'x',
        color: 'red',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a duplicate key with 409', async () => {
    await expect(
      createEnvironment(fx.owner.actor, { projectId: fx.projectId, key: 'staging', name: 'Again' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('is owner only', async () => {
    for (const who of [fx.editor, fx.viewer]) {
      await expect(
        createEnvironment(who.actor, { projectId: fx.projectId, key: 'qa', name: 'QA' }),
      ).rejects.toMatchObject({ status: 403 })
    }
  })
})

describe('listEnvironments and updateEnvironment', () => {
  it('lists in order for every role', async () => {
    for (const who of [fx.owner, fx.editor, fx.viewer]) {
      const list = await listEnvironments(who.actor, { projectId: fx.projectId })
      expect(list.map((e) => e.key)).toEqual(['development', 'staging', 'production'])
    }
  })

  it('updates name, color and production flag with before/after audit', async () => {
    const id = fx.environmentId('staging')
    const updated = await updateEnvironment(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: id,
      patch: { name: 'Pre-prod', color: '#000000', isProduction: true },
    })
    expect(updated).toMatchObject({
      key: 'staging',
      name: 'Pre-prod',
      color: '#000000',
      isProduction: true,
    })

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'environment.updated'))
    expect(entry?.before).toMatchObject({ name: 'Staging', isProduction: false })
    expect(entry?.after).toMatchObject({ name: 'Pre-prod', isProduction: true })
    expect(events.events).toContainEqual({
      type: 'ruleset.invalidate',
      projectId: fx.projectId,
      environmentId: id,
    })
  })

  it('404s for an environment of another project and blocks non-owners', async () => {
    const other = await createProjectFixture('other')
    await expect(
      updateEnvironment(fx.owner.actor, {
        projectId: fx.projectId,
        environmentId: other.environmentId('staging'),
        patch: { name: 'x' },
      }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      updateEnvironment(fx.editor.actor, {
        projectId: fx.projectId,
        environmentId: fx.environmentId('staging'),
        patch: { name: 'x' },
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('deleteEnvironment', () => {
  it('deletes the environment with its flag configurations and writes audit', async () => {
    const flag = await createFlag(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'f',
      name: 'F',
      type: 'boolean',
    })
    const id = fx.environmentId('staging')
    await deleteEnvironment(fx.owner.actor, { projectId: fx.projectId, environmentId: id })

    expect(await db.select().from(environments).where(eq(environments.id, id))).toHaveLength(0)
    const configs = await db
      .select()
      .from(flagEnvironments)
      .where(eq(flagEnvironments.flagId, flag.id))
    expect(configs).toHaveLength(2)
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'environment.deleted'))
    expect(entry).toMatchObject({ entityId: id, entityKey: 'staging' })
    expect(entry?.before).toMatchObject({ key: 'staging' })
    expect(events.events).toContainEqual({
      type: 'ruleset.invalidate',
      projectId: fx.projectId,
      environmentId: id,
    })
  })

  it('refuses to delete the last environment with a 400', async () => {
    await deleteEnvironment(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: fx.environmentId('development'),
    })
    await deleteEnvironment(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: fx.environmentId('staging'),
    })
    await expect(
      deleteEnvironment(fx.owner.actor, {
        projectId: fx.projectId,
        environmentId: fx.environmentId('production'),
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(
      await db
        .select()
        .from(environments)
        .where(and(eq(environments.projectId, fx.projectId))),
    ).toHaveLength(1)
  })

  it('is owner only', async () => {
    await expect(
      deleteEnvironment(fx.editor.actor, {
        projectId: fx.projectId,
        environmentId: fx.environmentId('staging'),
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('reorderEnvironments', () => {
  it('applies a new order', async () => {
    const [dev, staging, prod] = ['development', 'staging', 'production'].map(fx.environmentId)
    const reordered = await reorderEnvironments(fx.owner.actor, {
      projectId: fx.projectId,
      environmentIds: [prod as string, dev as string, staging as string],
    })
    expect(reordered.map((e) => e.key)).toEqual(['production', 'development', 'staging'])
    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'environment.updated'))
    expect(entries.length).toBeGreaterThan(0)
  })

  it('requires every environment exactly once', async () => {
    const dev = fx.environmentId('development')
    await expect(
      reorderEnvironments(fx.owner.actor, { projectId: fx.projectId, environmentIds: [dev] }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      reorderEnvironments(fx.owner.actor, {
        projectId: fx.projectId,
        environmentIds: [dev, dev, fx.environmentId('staging')],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('is owner only', async () => {
    await expect(
      reorderEnvironments(fx.editor.actor, {
        projectId: fx.projectId,
        environmentIds: ['development', 'staging', 'production'].map(fx.environmentId),
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
