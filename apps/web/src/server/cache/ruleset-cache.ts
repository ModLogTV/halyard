import { createHash } from 'node:crypto'
import type {
  FlagDefinition,
  FlagEnvironmentConfig,
  Ruleset,
  Segment,
} from '@modlogtv/halyard-engine'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import {
  environments,
  experiments,
  flagEnvironments,
  flags,
  organization,
  segments,
} from '@/db/schema'
import { subscribe } from '@/server/events'

export interface CachedRuleset {
  ruleset: Ruleset
  /** Strong ETag derived from the ruleset content; changes whenever any flag or segment changes. */
  etag: string
  projectId: string
  environmentId: string
  loadedAt: number
  /** Maps experiment key to experiment id for exposure recording. */
  experimentIds: Record<string, string>
  /** Maps flag key to flag id for evaluation stats. */
  flagIds: Record<string, string>
}

/**
 * Per-environment ruleset cache used on the evaluation path.
 *
 * Entries are built lazily from Postgres and dropped when a `ruleset.invalidate`
 * event arrives, so replicas never serve stale configuration for longer than the
 * event delivery latency. A safety TTL re-reads entries periodically in case a
 * notification was missed.
 */
const SAFETY_TTL_MS = 5 * 60_000
const cache = new Map<string, Promise<CachedRuleset | null>>()
const byProject = new Map<string, Set<string>>()

subscribe((event) => {
  if (event.type !== 'ruleset.invalidate') return
  if (event.environmentId) invalidateEnvironment(event.environmentId)
  else invalidateProject(event.projectId)
})

export function invalidateEnvironment(environmentId: string): void {
  cache.delete(environmentId)
}

export function invalidateProject(projectId: string): void {
  for (const envId of byProject.get(projectId) ?? []) cache.delete(envId)
  byProject.delete(projectId)
}

export function clearRulesetCache(): void {
  cache.clear()
  byProject.clear()
}

export const rulesetCacheStats = { hits: 0, misses: 0 }

/** Returns the ruleset for an environment, or null when the environment does not exist. */
export function getRuleset(environmentId: string): Promise<CachedRuleset | null> {
  const existing = cache.get(environmentId)
  if (existing) {
    rulesetCacheStats.hits += 1
    return existing.then((entry) => {
      if (entry && Date.now() - entry.loadedAt > SAFETY_TTL_MS) {
        cache.delete(environmentId)
        return getRuleset(environmentId)
      }
      return entry
    })
  }
  rulesetCacheStats.misses += 1
  const loading = loadRuleset(environmentId).catch((error) => {
    cache.delete(environmentId)
    throw error
  })
  cache.set(environmentId, loading)
  return loading
}

async function loadRuleset(environmentId: string): Promise<CachedRuleset | null> {
  const environment = await db.query.environments.findFirst({
    where: eq(environments.id, environmentId),
  })
  if (!environment) return null
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, environment.projectId),
    columns: { slug: true },
  })

  const [flagRows, configRows, segmentRows, experimentRows] = await Promise.all([
    db
      .select()
      .from(flags)
      .where(and(eq(flags.projectId, environment.projectId), isNull(flags.archivedAt))),
    db.select().from(flagEnvironments).where(eq(flagEnvironments.environmentId, environmentId)),
    db
      .select()
      .from(segments)
      .where(eq(segments.projectId, environment.projectId))
      .orderBy(segments.key),
    db
      .select()
      .from(experiments)
      .where(and(eq(experiments.environmentId, environmentId), eq(experiments.status, 'running'))),
  ])

  const configByFlag = new Map(configRows.map((c) => [c.flagId, c]))
  const experimentByFlag = new Map(experimentRows.map((e) => [e.flagId, e]))
  const experimentIds: Record<string, string> = {}
  const flagIds: Record<string, string> = {}

  const rulesetFlags: Ruleset['flags'] = {}
  for (const flag of flagRows) {
    const config = configByFlag.get(flag.id)
    if (!config) continue
    const definition: FlagDefinition = { key: flag.key, type: flag.type, variants: flag.variants }
    const envConfig: FlagEnvironmentConfig = {
      enabled: config.enabled,
      offVariant: config.offVariant,
      rules: config.rules,
      fallthrough: config.fallthrough,
    }
    const experiment = experimentByFlag.get(flag.id)
    if (experiment) {
      envConfig.experiment = { key: experiment.key, variations: experiment.allocation }
      experimentIds[experiment.key] = experiment.id
    }
    rulesetFlags[flag.key] = { flag: definition, config: envConfig }
    flagIds[flag.key] = flag.id
  }

  const rulesetSegments: Record<string, Segment> = {}
  for (const segment of segmentRows) {
    rulesetSegments[segment.key] = {
      key: segment.key,
      match: segment.match,
      conditions: segment.conditions,
    }
  }

  const ruleset: Ruleset = {
    version: 1,
    projectKey: org?.slug ?? environment.projectId,
    environmentKey: environment.key,
    generatedAt: new Date().toISOString(),
    flags: rulesetFlags,
    segments: rulesetSegments,
  }

  // The ETag excludes generatedAt so identical content yields the same tag across replicas.
  const etag = `"${createHash('sha256')
    .update(JSON.stringify({ f: ruleset.flags, s: ruleset.segments }))
    .digest('hex')
    .slice(0, 32)}"`

  const projectEnvs = byProject.get(environment.projectId) ?? new Set<string>()
  projectEnvs.add(environmentId)
  byProject.set(environment.projectId, projectEnvs)

  return {
    ruleset,
    etag,
    projectId: environment.projectId,
    environmentId,
    loadedAt: Date.now(),
    experimentIds,
    flagIds,
  }
}
