import type { JsonValue } from '@halyard/engine'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { apikey, environments } from '@/db/schema'
import { auth } from '@/lib/auth'
import { notFound } from '@/server/errors'
import { publish } from '@/server/events'
import {
  type CreateManagementKeyInput,
  type CreateSdkKeyInput,
  createManagementKeySchema,
  createSdkKeySchema,
  listApiKeysSchema,
  type RevokeApiKeyInput,
  revokeApiKeySchema,
} from '../schemas/api-keys'
import { recordAudit } from './audit'
import { assertProjectAccess, auditActor, type ProjectActorWithHeaders } from './authz'
import { authCall, parseInput } from './util'

export interface ApiKeySummary {
  id: string
  name: string | null
  /** The first characters of the key, shown so keys can be told apart. */
  start: string | null
  configId: 'sdk' | 'management'
  metadata: Record<string, JsonValue> | null
  permissions: Record<string, string[]> | null
  createdAt: Date
  lastRequest: Date | null
  expiresAt: Date | null
  enabled: boolean
  /** Set for SDK keys: the environment the key evaluates flags for. */
  environmentId?: string
}

/** A freshly created key. The plaintext `key` is only ever returned here. */
export interface CreatedApiKey {
  id: string
  key: string
  start: string | null
}

const CONFIG_IDS = ['sdk', 'management'] as const

function asRecord(value: unknown): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null
}

export async function listApiKeys(
  actor: ProjectActorWithHeaders,
  input: { projectId: string },
): Promise<ApiKeySummary[]> {
  const { projectId } = parseInput(listApiKeysSchema, input)
  assertProjectAccess(actor, projectId, { apiKey: ['read'] })

  const lists = await Promise.all(
    CONFIG_IDS.map((configId) =>
      authCall(() =>
        auth.api.listApiKeys({
          headers: actor.headers,
          query: { organizationId: projectId, configId },
        }),
      ),
    ),
  )

  const keys: ApiKeySummary[] = []
  for (const [index, list] of lists.entries()) {
    for (const key of list.apiKeys) {
      const metadata = asRecord(key.metadata)
      const environmentId =
        metadata && typeof metadata.environmentId === 'string' ? metadata.environmentId : undefined
      keys.push({
        id: key.id,
        name: key.name,
        start: key.start,
        configId: CONFIG_IDS[index] ?? 'sdk',
        metadata,
        permissions: asRecord(key.permissions) as Record<string, string[]> | null,
        createdAt: key.createdAt,
        lastRequest: key.lastRequest,
        expiresAt: key.expiresAt,
        enabled: key.enabled ?? true,
        ...(environmentId && { environmentId }),
      })
    }
  }
  return keys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/** Creates an environment-scoped SDK key. The plaintext key is returned once and never stored. */
export async function createSdkKey(
  actor: ProjectActorWithHeaders,
  input: CreateSdkKeyInput,
): Promise<CreatedApiKey> {
  const data = parseInput(createSdkKeySchema, input)
  assertProjectAccess(actor, data.projectId, { apiKey: ['create'] })

  const [environment] = await db
    .select({ id: environments.id, key: environments.key })
    .from(environments)
    .where(and(eq(environments.id, data.environmentId), eq(environments.projectId, data.projectId)))
  if (!environment) throw notFound('Environment')

  const created = await authCall(() =>
    auth.api.createApiKey({
      headers: actor.headers,
      body: {
        configId: 'sdk',
        organizationId: data.projectId,
        name: data.name,
        metadata: { projectId: data.projectId, environmentId: environment.id },
      },
    }),
  )

  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      projectId: data.projectId,
      environmentId: environment.id,
      actor: auditActor(actor),
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: created.id,
      entityKey: data.name,
      after: { name: data.name, configId: 'sdk', environmentId: environment.id },
    })
    await publish({ type: 'apikey.invalidate' }, tx)
  })

  return { id: created.id, key: created.key, start: created.start ?? null }
}

/**
 * Creates a project-scoped management key for the CLI and REST API. Permissions can
 * only be set by server-side calls, so the actor's `apiKey:create` permission is
 * verified here before calling the plugin without request headers.
 */
export async function createManagementKey(
  actor: ProjectActorWithHeaders,
  input: CreateManagementKeyInput,
): Promise<CreatedApiKey> {
  const data = parseInput(createManagementKeySchema, input)
  assertProjectAccess(actor, data.projectId, { apiKey: ['create'] })

  const permissions = { project: data.access === 'write' ? ['read', 'write'] : ['read'] }
  const created = await authCall(() =>
    auth.api.createApiKey({
      body: {
        configId: 'management',
        organizationId: data.projectId,
        userId: actor.userId,
        name: data.name,
        permissions,
        metadata: { projectId: data.projectId },
      },
    }),
  )

  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      projectId: data.projectId,
      actor: auditActor(actor),
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: created.id,
      entityKey: data.name,
      after: { name: data.name, configId: 'management', permissions },
    })
    await publish({ type: 'apikey.invalidate' }, tx)
  })

  return { id: created.id, key: created.key, start: created.start ?? null }
}

export async function revokeApiKey(
  actor: ProjectActorWithHeaders,
  input: RevokeApiKeyInput,
): Promise<{ id: string }> {
  const { projectId, keyId, configId } = parseInput(revokeApiKeySchema, input)
  assertProjectAccess(actor, projectId, { apiKey: ['delete'] })

  const [existing] = await db
    .select()
    .from(apikey)
    .where(
      and(eq(apikey.id, keyId), eq(apikey.referenceId, projectId), eq(apikey.configId, configId)),
    )
  if (!existing) throw notFound('API key')

  await authCall(() => auth.api.deleteApiKey({ headers: actor.headers, body: { keyId, configId } }))

  const metadata = asRecord(safeParse(existing.metadata))
  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      projectId,
      environmentId: typeof metadata?.environmentId === 'string' ? metadata.environmentId : null,
      actor: auditActor(actor),
      action: 'api_key.deleted',
      entityType: 'api_key',
      entityId: keyId,
      entityKey: existing.name,
      before: {
        name: existing.name,
        configId,
        ...(typeof metadata?.environmentId === 'string' && {
          environmentId: metadata.environmentId,
        }),
      },
    })
    await publish({ type: 'apikey.invalidate' }, tx)
  })
  return { id: keyId }
}

function safeParse(raw: string | null): unknown {
  let value: unknown = raw
  for (let i = 0; i < 2 && typeof value === 'string'; i += 1) {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}
