import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { environments } from '@/db/schema'
import { auth, MANAGEMENT_KEY_PREFIX, SDK_KEY_PREFIX } from '@/lib/auth'
import { forbidden, unauthorized } from '@/server/errors'
import { subscribe } from '@/server/events'

export interface SdkKeyMetadata {
  environmentId: string
  projectId: string
}

export interface SdkPrincipal {
  kind: 'sdk'
  keyId: string
  keyName: string
  projectId: string
  environmentId: string
}

export interface ManagementPrincipal {
  kind: 'management'
  keyId: string
  keyName: string
  projectId: string
  permissions: Record<string, string[]>
}

type CacheEntry<T> = { value: T | null; expiresAt: number }

/**
 * Verified keys are cached briefly so evaluation requests do not hit Postgres for
 * authentication. Deleting a key publishes an invalidation event to every replica.
 */
const VERIFY_CACHE_TTL_MS = 60_000
const sdkCache = new Map<string, CacheEntry<SdkPrincipal>>()
const managementCache = new Map<string, CacheEntry<ManagementPrincipal>>()

subscribe((event) => {
  if (event.type === 'apikey.invalidate') {
    sdkCache.clear()
    managementCache.clear()
  }
})

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Reads a bearer or x-api-key credential from the request. */
export function extractApiKey(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header) {
    const [scheme, value] = header.split(' ')
    if (scheme?.toLowerCase() === 'bearer' && value) return value.trim()
    if (scheme?.toLowerCase() === 'apikey' && value) return value.trim()
  }
  const direct = request.headers.get('x-api-key')
  return direct ? direct.trim() : null
}

async function verify(key: string, configId: 'sdk' | 'management') {
  // Halyard has no default api-key configuration, so the config must always be named.
  const result = await auth.api.verifyApiKey({ body: { key, configId } })
  if (!result.valid || !result.key) return null
  return result.key
}

/** Authenticates an environment-scoped SDK key (OFREP, tracking). */
export async function authenticateSdkKey(request: Request): Promise<SdkPrincipal> {
  const key = extractApiKey(request)
  if (!key) throw unauthorized('Provide an SDK key in the Authorization header')
  if (!key.startsWith(SDK_KEY_PREFIX)) throw unauthorized('This endpoint requires an SDK key')
  const hash = hashKey(key)
  const cached = sdkCache.get(hash)
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.value) throw unauthorized('Invalid SDK key')
    return cached.value
  }
  const verified = await verify(key, 'sdk')
  // The owning project comes from the key's reference (set by the plugin), never
  // from metadata, which callers of the raw better-auth endpoint can choose freely.
  // The environment id in metadata is only accepted when it belongs to that project.
  const metadata = (verified?.metadata ?? null) as Partial<SdkKeyMetadata> | null
  let principal: SdkPrincipal | null = null
  if (verified && metadata?.environmentId) {
    const environment = await db.query.environments.findFirst({
      where: and(
        eq(environments.id, metadata.environmentId),
        eq(environments.projectId, verified.referenceId),
      ),
      columns: { id: true, projectId: true },
    })
    if (environment) {
      principal = {
        kind: 'sdk',
        keyId: verified.id,
        keyName: verified.name ?? 'SDK key',
        projectId: environment.projectId,
        environmentId: environment.id,
      }
    }
  }
  sdkCache.set(hash, { value: principal, expiresAt: Date.now() + VERIFY_CACHE_TTL_MS })
  if (!principal) throw unauthorized('Invalid SDK key')
  return principal
}

/** Authenticates a project-scoped management key (CLI, REST API) and checks permissions. */
export async function authenticateManagementKey(
  request: Request,
  required?: Record<string, string[]>,
): Promise<ManagementPrincipal> {
  const key = extractApiKey(request)
  if (!key) throw unauthorized('Provide a management key in the Authorization header')
  if (!key.startsWith(MANAGEMENT_KEY_PREFIX))
    throw unauthorized('This endpoint requires a management key')
  const hash = hashKey(key)
  let principal: ManagementPrincipal | null
  const cached = managementCache.get(hash)
  if (cached && cached.expiresAt > Date.now()) {
    principal = cached.value
  } else {
    const verified = await verify(key, 'management')
    principal = verified
      ? {
          kind: 'management',
          keyId: verified.id,
          keyName: verified.name ?? 'Management key',
          projectId: verified.referenceId,
          permissions: (verified.permissions as Record<string, string[]> | null) ?? {},
        }
      : null
    managementCache.set(hash, { value: principal, expiresAt: Date.now() + VERIFY_CACHE_TTL_MS })
  }
  if (!principal) throw unauthorized('Invalid management key')
  if (required) {
    for (const [resource, actions] of Object.entries(required)) {
      const granted = principal.permissions[resource] ?? []
      if (!actions.every((a) => granted.includes(a))) {
        throw forbidden(`This key lacks the ${resource}:${actions.join(',')} permission`)
      }
    }
  }
  return principal
}

/** Clears the local verification cache; used by tests and the invalidation handler. */
export function clearApiKeyCache(): void {
  sdkCache.clear()
  managementCache.clear()
}
