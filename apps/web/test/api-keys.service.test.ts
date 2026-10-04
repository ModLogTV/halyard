import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { apikey, auditLog } from '@/db/schema'
import { auth } from '@/lib/auth'
import {
  createManagementKey,
  createSdkKey,
  listApiKeys,
  revokeApiKey,
} from '@/server/services/api-keys'
import { deleteEnvironment } from '@/server/services/environments'
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

/** Verifies a key the way the evaluation endpoints do, through the api-key plugin. */
async function verifyKey(key: string, configId: 'sdk' | 'management') {
  const result = await auth.api.verifyApiKey({ body: { key, configId } })
  return result.valid ? result.key : null
}

describe('createSdkKey', () => {
  it('returns the plaintext key once and binds the key to the environment', async () => {
    const envId = fx.environmentId('production')
    const created = await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: envId,
      name: 'Web app',
    })
    expect(created.key).toMatch(/^hal_sdk_/)
    expect(created.start).toBe(created.key.slice(0, 12))

    const [row] = await db.select().from(apikey).where(eq(apikey.id, created.id))
    expect(row?.key).not.toBe(created.key)
    expect(row).toMatchObject({ configId: 'sdk', referenceId: fx.projectId, name: 'Web app' })

    const verified = await verifyKey(created.key, 'sdk')
    expect(verified).toMatchObject({ id: created.id, referenceId: fx.projectId })
    expect(verified?.metadata).toEqual({ projectId: fx.projectId, environmentId: envId })
  })

  it('audits the creation without leaking the key', async () => {
    const envId = fx.environmentId('staging')
    const created = await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: envId,
      name: 'CI',
    })
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'api_key.created'))
    expect(entry).toMatchObject({
      entityType: 'api_key',
      entityId: created.id,
      environmentId: envId,
      actorId: fx.owner.user.id,
    })
    expect(entry?.after).toEqual({ name: 'CI', configId: 'sdk', environmentId: envId })
    expect(JSON.stringify(entry)).not.toContain(created.key)
    expect(events.events).toContainEqual({ type: 'apikey.invalidate' })
  })

  it('rejects an environment from another project', async () => {
    const other = await createProjectFixture('other')
    await expect(
      createSdkKey(fx.owner.actor, {
        projectId: fx.projectId,
        environmentId: other.environmentId('production'),
        name: 'Sneaky',
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(await db.select().from(apikey)).toHaveLength(0)
  })

  it('validates the name', async () => {
    await expect(
      createSdkKey(fx.owner.actor, {
        projectId: fx.projectId,
        environmentId: fx.environmentId('staging'),
        name: ' ',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('is owner only', async () => {
    for (const who of [fx.editor, fx.viewer]) {
      await expect(
        createSdkKey(who.actor, {
          projectId: fx.projectId,
          environmentId: fx.environmentId('staging'),
          name: 'x',
        }),
      ).rejects.toMatchObject({ status: 403 })
    }
    expect(await db.select().from(apikey)).toHaveLength(0)
  })

  it('cannot be bypassed by forging the role (the plugin checks real membership)', async () => {
    const forged = { ...fx.editor.actor, role: 'owner' as const }
    await expect(
      createSdkKey(forged, {
        projectId: fx.projectId,
        environmentId: fx.environmentId('staging'),
        name: 'x',
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('createManagementKey', () => {
  it('creates a read key with project:read', async () => {
    const created = await createManagementKey(fx.owner.actor, {
      projectId: fx.projectId,
      name: 'CLI',
      access: 'read',
    })
    expect(created.key).toMatch(/^hal_mgmt_/)
    const [row] = await db.select().from(apikey).where(eq(apikey.id, created.id))
    expect(JSON.parse(row?.permissions ?? 'null')).toEqual({ project: ['read'] })
    expect(row).toMatchObject({ configId: 'management', referenceId: fx.projectId })

    expect(await verifyKey(created.key, 'management')).toMatchObject({ referenceId: fx.projectId })
    const read = await auth.api.verifyApiKey({
      body: { key: created.key, configId: 'management', permissions: { project: ['read'] } },
    })
    const write = await auth.api.verifyApiKey({
      body: { key: created.key, configId: 'management', permissions: { project: ['write'] } },
    })
    expect(read.valid).toBe(true)
    expect(write.valid).toBe(false)
  })

  it('creates a write key with project:read and project:write', async () => {
    const created = await createManagementKey(fx.owner.actor, {
      projectId: fx.projectId,
      name: 'Deploy',
      access: 'write',
    })
    const verified = await verifyKey(created.key, 'management')
    expect(verified?.permissions).toEqual({ project: ['read', 'write'] })
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'api_key.created'))
    expect(entry?.after).toEqual({
      name: 'Deploy',
      configId: 'management',
      permissions: { project: ['read', 'write'] },
    })
  })

  it('is owner only', async () => {
    for (const who of [fx.editor, fx.viewer]) {
      await expect(
        createManagementKey(who.actor, { projectId: fx.projectId, name: 'x', access: 'write' }),
      ).rejects.toMatchObject({ status: 403 })
    }
    const forged = { ...fx.editor.actor, role: 'owner' as const }
    await expect(
      createManagementKey(forged, { projectId: fx.projectId, name: 'x', access: 'write' }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await db.select().from(apikey)).toHaveLength(0)
  })
})

describe('listApiKeys', () => {
  it('merges SDK and management keys, newest first, without secrets', async () => {
    const envId = fx.environmentId('development')
    const sdk = await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: envId,
      name: 'SDK',
    })
    const mgmt = await createManagementKey(fx.owner.actor, {
      projectId: fx.projectId,
      name: 'CLI',
      access: 'read',
    })

    const list = await listApiKeys(fx.viewer.actor, { projectId: fx.projectId })
    expect(list.map((k) => k.id)).toEqual([mgmt.id, sdk.id])
    expect(list[1]).toMatchObject({
      id: sdk.id,
      name: 'SDK',
      start: sdk.start,
      configId: 'sdk',
      environmentId: envId,
      enabled: true,
      lastRequest: null,
      expiresAt: null,
      permissions: null,
    })
    expect(list[1]?.metadata).toEqual({ projectId: fx.projectId, environmentId: envId })
    expect(list[0]).toMatchObject({ configId: 'management', permissions: { project: ['read'] } })
    expect(list[0]?.environmentId).toBeUndefined()
    expect(JSON.stringify(list)).not.toContain(sdk.key)
    expect(list.every((k) => !('key' in k))).toBe(true)
  })

  it('only shows keys of the requested project and refuses outsiders', async () => {
    await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: fx.environmentId('development'),
      name: 'Mine',
    })
    const other = await createProjectFixture('other')
    expect(await listApiKeys(other.owner.actor, { projectId: other.projectId })).toEqual([])
    await expect(listApiKeys(other.owner.actor, { projectId: fx.projectId })).rejects.toMatchObject(
      { status: 403 },
    )
  })
})

describe('revokeApiKey', () => {
  it('deletes the key, audits it and invalidates the verification cache', async () => {
    const envId = fx.environmentId('production')
    const created = await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: envId,
      name: 'Web',
    })
    expect(await verifyKey(created.key, 'sdk')).not.toBeNull()
    events.events.length = 0

    await revokeApiKey(fx.owner.actor, {
      projectId: fx.projectId,
      keyId: created.id,
      configId: 'sdk',
    })

    expect(await db.select().from(apikey)).toHaveLength(0)
    expect(events.events).toEqual([{ type: 'apikey.invalidate' }])
    expect(await verifyKey(created.key, 'sdk')).toBeNull()

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'api_key.deleted'))
    expect(entry).toMatchObject({ entityId: created.id, environmentId: envId })
    expect(entry?.before).toEqual({ name: 'Web', configId: 'sdk', environmentId: envId })
  })

  it('revokes management keys', async () => {
    const created = await createManagementKey(fx.owner.actor, {
      projectId: fx.projectId,
      name: 'CLI',
      access: 'read',
    })
    await revokeApiKey(fx.owner.actor, {
      projectId: fx.projectId,
      keyId: created.id,
      configId: 'management',
    })
    expect(await verifyKey(created.key, 'management')).toBeNull()
  })

  it('is owner only', async () => {
    const created = await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: fx.environmentId('production'),
      name: 'Web',
    })
    for (const who of [fx.editor, fx.viewer]) {
      await expect(
        revokeApiKey(who.actor, { projectId: fx.projectId, keyId: created.id, configId: 'sdk' }),
      ).rejects.toMatchObject({ status: 403 })
    }
    expect(await db.select().from(apikey)).toHaveLength(1)
  })

  it('404s for unknown keys, a wrong config, or keys of another project', async () => {
    const created = await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: fx.environmentId('production'),
      name: 'Web',
    })
    await expect(
      revokeApiKey(fx.owner.actor, { projectId: fx.projectId, keyId: 'nope', configId: 'sdk' }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      revokeApiKey(fx.owner.actor, {
        projectId: fx.projectId,
        keyId: created.id,
        configId: 'management',
      }),
    ).rejects.toMatchObject({ status: 404 })
    const other = await createProjectFixture('other')
    await expect(
      revokeApiKey(other.owner.actor, {
        projectId: other.projectId,
        keyId: created.id,
        configId: 'sdk',
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(await db.select().from(apikey)).toHaveLength(1)
  })
})

describe('environment deletion', () => {
  it('revokes the SDK keys bound to the deleted environment only', async () => {
    const staging = fx.environmentId('staging')
    const doomed = await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: staging,
      name: 'Staging',
    })
    const kept = await createSdkKey(fx.owner.actor, {
      projectId: fx.projectId,
      environmentId: fx.environmentId('production'),
      name: 'Prod',
    })
    const mgmt = await createManagementKey(fx.owner.actor, {
      projectId: fx.projectId,
      name: 'CLI',
      access: 'read',
    })

    await deleteEnvironment(fx.owner.actor, { projectId: fx.projectId, environmentId: staging })

    const remaining = (await db.select().from(apikey)).map((k) => k.id).sort()
    expect(remaining).toEqual([kept.id, mgmt.id].sort())
    expect(await verifyKey(doomed.key, 'sdk')).toBeNull()
    expect(await verifyKey(kept.key, 'sdk')).not.toBeNull()
  })
})
