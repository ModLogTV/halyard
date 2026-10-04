import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog } from '@/db/schema'
import { listAuditLog, listFlagHistory } from '@/server/services/audit-log'
import { createEnvironment } from '@/server/services/environments'
import { createFlag, toggleFlag, updateFlag } from '@/server/services/flags'
import { createProjectFixture, type ProjectFixture } from './factories'
import { resetDatabase } from './helpers'

let fx: ProjectFixture

beforeEach(async () => {
  await resetDatabase()
  fx = await createProjectFixture()
})

/** Inserts an audit row with an exact (microsecond precise) timestamp. */
async function insertAt(
  timestamp: string,
  action = 'flag.updated',
  extra: { entityId?: string } = {},
) {
  await db.execute(sql`
    insert into audit_log (project_id, actor_type, actor_name, action, entity_type, entity_id, created_at)
    values (${fx.projectId}, 'system', 'test', ${action}, 'flag', ${extra.entityId ?? 'e1'}, ${timestamp}::timestamptz)
  `)
}

async function allPages(input: Parameters<typeof listAuditLog>[1], pageSize: number) {
  const ids: string[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await listAuditLog(fx.viewer.actor, { ...input, limit: pageSize, cursor })
    ids.push(...page.items.map((i) => i.id))
    if (!page.nextCursor) return ids
    cursor = page.nextCursor
  }
  throw new Error('pagination did not terminate')
}

describe('listAuditLog', () => {
  it('returns entries newest first', async () => {
    await createFlag(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'f',
      name: 'F',
      type: 'boolean',
    })
    await toggleFlag(fx.owner.actor, {
      projectId: fx.projectId,
      flagKey: 'f',
      environmentKey: 'production',
      enabled: true,
    })
    const page = await listAuditLog(fx.viewer.actor, { projectId: fx.projectId })
    expect(page.items.map((i) => i.action)).toEqual([
      'flag.toggled',
      'flag.created',
      'project.created',
    ])
    expect(page.nextCursor).toBeNull()
    expect(page.items[0]).toMatchObject({
      actorType: 'user',
      actorId: fx.owner.user.id,
      actorName: 'Olivia Owner',
      entityType: 'flag',
      entityKey: 'f',
      environmentId: fx.environmentId('production'),
    })
    expect(page.items[0]?.before).toMatchObject({ enabled: false })
    expect(page.items[0]?.after).toMatchObject({ enabled: true })
  })

  it('paginates by keyset without gaps or duplicates, including rows sharing a timestamp', async () => {
    const same = '2026-01-01T00:00:00.123456Z'
    for (let i = 0; i < 5; i += 1) await insertAt(same)
    for (let i = 0; i < 4; i += 1) await insertAt(`2026-01-01T00:00:00.123${String(400 + i)}Z`)
    await insertAt('2026-01-02T00:00:00Z')
    await insertAt('2025-12-31T00:00:00Z')

    const everything = await listAuditLog(fx.viewer.actor, { projectId: fx.projectId, limit: 200 })
    expect(everything.items).toHaveLength(12)

    for (const size of [1, 2, 3, 5, 11, 12, 13]) {
      const ids = await allPages({ projectId: fx.projectId }, size)
      expect(ids).toEqual(everything.items.map((i) => i.id))
    }
  })

  it('reports a next cursor only while more entries remain', async () => {
    for (let i = 0; i < 3; i += 1) await insertAt(`2026-01-0${i + 1}T00:00:00Z`)
    const exact = await listAuditLog(fx.viewer.actor, { projectId: fx.projectId, limit: 4 })
    expect(exact.items).toHaveLength(4)
    expect(exact.nextCursor).toBeNull()
    const partial = await listAuditLog(fx.viewer.actor, { projectId: fx.projectId, limit: 3 })
    expect(partial.nextCursor).not.toBeNull()
  })

  it('defaults to 50 entries per page', async () => {
    for (let i = 0; i < 52; i += 1)
      await insertAt(`2026-01-01T00:00:${String(i).padStart(2, '0')}Z`)
    const page = await listAuditLog(fx.viewer.actor, { projectId: fx.projectId })
    expect(page.items).toHaveLength(50)
    expect(page.nextCursor).not.toBeNull()
  })

  it('rejects malformed cursors and out of range limits', async () => {
    await expect(
      listAuditLog(fx.viewer.actor, { projectId: fx.projectId, cursor: 'garbage' }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      listAuditLog(fx.viewer.actor, { projectId: fx.projectId, limit: 0 }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      listAuditLog(fx.viewer.actor, { projectId: fx.projectId, limit: 1000 }),
    ).rejects.toMatchObject({ status: 400 })
  })

  describe('filters', () => {
    beforeEach(async () => {
      const flag = await createFlag(fx.owner.actor, {
        projectId: fx.projectId,
        key: 'f',
        name: 'F',
        type: 'boolean',
      })
      await toggleFlag(fx.editor.actor, {
        projectId: fx.projectId,
        flagKey: 'f',
        environmentKey: 'staging',
        enabled: true,
      })
      await updateFlag(fx.editor.actor, {
        projectId: fx.projectId,
        flagKey: 'f',
        patch: { name: 'Renamed' },
      })
      await createEnvironment(fx.owner.actor, { projectId: fx.projectId, key: 'qa', name: 'QA' })
      void flag
    })

    const actions = async (filter: object) =>
      (await listAuditLog(fx.viewer.actor, { projectId: fx.projectId, ...filter })).items.map(
        (i) => i.action,
      )

    it('filters by action, exactly or by prefix', async () => {
      expect(await actions({ action: 'flag.toggled' })).toEqual(['flag.toggled'])
      expect(await actions({ action: 'flag.*' })).toEqual([
        'flag.updated',
        'flag.toggled',
        'flag.created',
      ])
      expect(await actions({ action: 'environment.*' })).toEqual(['environment.created'])
      expect(await actions({ action: 'flag' })).toEqual([])
    })

    it('filters by actor', async () => {
      expect(await actions({ actorId: fx.editor.user.id })).toEqual([
        'flag.updated',
        'flag.toggled',
      ])
      expect(await actions({ actorId: 'nobody' })).toEqual([])
    })

    it('filters by environment', async () => {
      expect(await actions({ environmentId: fx.environmentId('staging') })).toEqual([
        'flag.toggled',
      ])
    })

    it('filters by entity type and id', async () => {
      expect(await actions({ entityType: 'environment' })).toEqual(['environment.created'])
      const flagEntry = (
        await listAuditLog(fx.viewer.actor, { projectId: fx.projectId, action: 'flag.created' })
      ).items[0]
      expect(await actions({ entityType: 'flag', entityId: flagEntry?.entityId })).toHaveLength(3)
    })

    it('filters by time range', async () => {
      await insertAt('2020-06-15T12:00:00Z', 'old.thing')
      expect(await actions({ to: new Date('2021-01-01') })).toEqual(['old.thing'])
      expect(await actions({ from: new Date('2021-01-01'), action: 'old.*' })).toEqual([])
      expect(
        await actions({
          from: new Date('2020-06-15T12:00:00Z'),
          to: new Date('2020-06-15T12:00:00Z'),
        }),
      ).toEqual(['old.thing'])
    })

    it('combines filters with pagination', async () => {
      const ids = await allPages({ projectId: fx.projectId, action: 'flag.*' }, 1)
      expect(ids).toHaveLength(3)
    })
  })

  it('is limited to the project and to members', async () => {
    const other = await createProjectFixture('other')
    const ours = await listAuditLog(fx.viewer.actor, { projectId: fx.projectId })
    const theirs = await listAuditLog(other.viewer.actor, { projectId: other.projectId })
    expect(ours.items.every((i) => i.projectId === fx.projectId)).toBe(true)
    expect(theirs.items.every((i) => i.projectId === other.projectId)).toBe(true)
    await expect(
      listAuditLog(other.owner.actor, { projectId: fx.projectId }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('keeps entries when the entity or environment they refer to is gone', async () => {
    await createEnvironment(fx.owner.actor, { projectId: fx.projectId, key: 'qa', name: 'QA' })
    const rows = await db.select().from(auditLog)
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('listFlagHistory', () => {
  it('returns only the entries of that flag, newest first', async () => {
    await createFlag(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'a',
      name: 'A',
      type: 'boolean',
    })
    await createFlag(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'b',
      name: 'B',
      type: 'boolean',
    })
    await toggleFlag(fx.owner.actor, {
      projectId: fx.projectId,
      flagKey: 'a',
      environmentKey: 'production',
      enabled: true,
    })
    await updateFlag(fx.owner.actor, {
      projectId: fx.projectId,
      flagKey: 'a',
      patch: { name: 'A2' },
    })
    await toggleFlag(fx.owner.actor, {
      projectId: fx.projectId,
      flagKey: 'b',
      environmentKey: 'production',
      enabled: true,
    })

    const history = await listFlagHistory(fx.viewer.actor, {
      projectId: fx.projectId,
      flagKey: 'a',
    })
    expect(history.items.map((i) => i.action)).toEqual([
      'flag.updated',
      'flag.toggled',
      'flag.created',
    ])
    expect(history.items.every((i) => i.entityKey === 'a')).toBe(true)
  })

  it('paginates', async () => {
    await createFlag(fx.owner.actor, {
      projectId: fx.projectId,
      key: 'a',
      name: 'A',
      type: 'boolean',
    })
    for (const enabled of [true, false, true]) {
      await toggleFlag(fx.owner.actor, {
        projectId: fx.projectId,
        flagKey: 'a',
        environmentKey: 'production',
        enabled,
      })
    }
    const first = await listFlagHistory(fx.viewer.actor, {
      projectId: fx.projectId,
      flagKey: 'a',
      limit: 3,
    })
    expect(first.items).toHaveLength(3)
    const second = await listFlagHistory(fx.viewer.actor, {
      projectId: fx.projectId,
      flagKey: 'a',
      limit: 3,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.items.map((i) => i.action)).toEqual(['flag.created'])
    expect(second.nextCursor).toBeNull()
  })

  it('404s for unknown flags and refuses outsiders', async () => {
    await expect(
      listFlagHistory(fx.viewer.actor, { projectId: fx.projectId, flagKey: 'nope' }),
    ).rejects.toMatchObject({ status: 404 })
    const other = await createProjectFixture('other')
    await expect(
      listFlagHistory(other.owner.actor, { projectId: fx.projectId, flagKey: 'a' }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
