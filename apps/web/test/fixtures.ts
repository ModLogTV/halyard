import type {
  AttributeCondition,
  FlagType,
  RolloutVariation,
  Rule,
  Serve,
  Variant,
} from '@modlogtv/halyard-engine'
import { sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  environments,
  experiments,
  flagEnvironments,
  flags,
  member,
  organization,
  projects,
  segments,
  user,
} from '@/db/schema'
import { auth } from '@/lib/auth'
import { clearApiKeyCache } from '@/server/auth/api-key'
import { clearRulesetCache } from '@/server/cache/ruleset-cache'
import { resetTracking } from '@/server/evaluation/tracking'

/**
 * Fixtures for evaluation and OFREP tests. Rows are inserted directly with Drizzle so
 * these tests do not depend on the management services.
 */

let counter = 0
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`

/** Truncates every application table and clears the in-memory caches and tracking buffers. */
export async function truncateAll(): Promise<void> {
  await db.execute(sql`
    truncate table
      "audit_log", "webhook_deliveries", "webhooks", "scheduled_changes",
      "flag_evaluation_stats", "flag_evaluation_buckets",
      "experiment_conversions", "experiment_exposures", "experiments",
      "flag_environments", "flags", "segments", "environments", "projects",
      "apikey", "invitation", "member", "organization",
      "verification", "account", "session", "user"
    restart identity cascade
  `)
  clearApiKeyCache()
  clearRulesetCache()
  resetTracking()
}

export interface FixtureEnvironment {
  id: string
  key: string
}

export interface FixtureProject {
  projectId: string
  slug: string
  environments: Record<string, FixtureEnvironment>
}

/** Inserts an organization, its project row and environments (default: development, production). */
export async function createFixtureProject(
  options: { slug?: string; environments?: string[] } = {},
): Promise<FixtureProject> {
  const projectId = `org_${unique()}`
  const slug = options.slug ?? `project-${unique()}`
  await db.insert(organization).values({ id: projectId, name: slug, slug, createdAt: new Date() })
  await db.insert(projects).values({ id: projectId })
  const keys = options.environments ?? ['development', 'production']
  const rows = await db
    .insert(environments)
    .values(
      keys.map((key, index) => ({
        projectId,
        key,
        name: key,
        isProduction: key === 'production',
        sortOrder: index,
      })),
    )
    .returning({ id: environments.id, key: environments.key })
  return { projectId, slug, environments: Object.fromEntries(rows.map((row) => [row.key, row])) }
}

export interface FixtureFlagConfig {
  enabled?: boolean
  offVariant?: string
  rules?: Rule[]
  fallthrough?: Serve
}

export interface FixtureFlagOptions {
  projectId: string
  key: string
  type?: FlagType
  variants?: Variant[]
  /** Configuration per environment id. Environments not listed get no configuration. */
  environments: Record<string, FixtureFlagConfig>
  archived?: boolean
}

const BOOLEAN_VARIANTS: Variant[] = [
  { key: 'on', value: true },
  { key: 'off', value: false },
]

/** Inserts a flag and its per-environment configuration. Defaults to a boolean flag serving `on`. */
export async function createFixtureFlag(
  options: FixtureFlagOptions,
): Promise<{ id: string; key: string }> {
  const variants = options.variants ?? BOOLEAN_VARIANTS
  const [flag] = await db
    .insert(flags)
    .values({
      projectId: options.projectId,
      key: options.key,
      name: options.key,
      type: options.type ?? 'boolean',
      variants,
      archivedAt: options.archived ? new Date() : null,
    })
    .returning({ id: flags.id, key: flags.key })
  if (!flag) throw new Error('flag insert returned nothing')
  const configs = Object.entries(options.environments)
  if (configs.length > 0) {
    await db.insert(flagEnvironments).values(
      configs.map(([environmentId, config]) => ({
        flagId: flag.id,
        environmentId,
        enabled: config.enabled ?? true,
        offVariant: config.offVariant ?? variants[variants.length - 1]?.key ?? 'off',
        rules: config.rules ?? [],
        fallthrough: config.fallthrough ?? { type: 'variant', variant: variants[0]?.key ?? 'on' },
      })),
    )
  }
  return flag
}

/** Inserts a segment. */
export async function createFixtureSegment(options: {
  projectId: string
  key: string
  conditions: AttributeCondition[]
  match?: 'all' | 'any'
}): Promise<{ id: string; key: string }> {
  const [segment] = await db
    .insert(segments)
    .values({
      projectId: options.projectId,
      key: options.key,
      name: options.key,
      match: options.match ?? 'all',
      conditions: options.conditions,
    })
    .returning({ id: segments.id, key: segments.key })
  if (!segment) throw new Error('segment insert returned nothing')
  return segment
}

/** Inserts an experiment (running by default) on a flag in one environment. */
export async function createFixtureExperiment(options: {
  projectId: string
  flagId: string
  environmentId: string
  key: string
  allocation: RolloutVariation[]
  controlVariant: string
  status?: 'draft' | 'running' | 'stopped'
}): Promise<{ id: string; key: string }> {
  const [experiment] = await db
    .insert(experiments)
    .values({
      projectId: options.projectId,
      flagId: options.flagId,
      environmentId: options.environmentId,
      key: options.key,
      name: options.key,
      status: options.status ?? 'running',
      allocation: options.allocation,
      conversionEvent: 'converted',
      controlVariant: options.controlVariant,
      startedAt: new Date(),
    })
    .returning({ id: experiments.id, key: experiments.key })
  if (!experiment) throw new Error('experiment insert returned nothing')
  return experiment
}

/**
 * Creates a real SDK key through better-auth for an environment and returns the
 * plaintext key. An owner user is inserted for the organization because the API key
 * plugin checks membership.
 */
export async function createFixtureSdkKey(
  projectId: string,
  environmentId: string,
): Promise<string> {
  const userId = `user_${unique()}`
  const now = new Date()
  await db.insert(user).values({
    id: userId,
    name: 'Fixture Owner',
    email: `${userId}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(member).values({
    id: `member_${unique()}`,
    organizationId: projectId,
    userId,
    role: 'owner',
    createdAt: now,
  })
  const created = await auth.api.createApiKey({
    body: {
      configId: 'sdk',
      organizationId: projectId,
      userId,
      name: 'Fixture SDK key',
      metadata: { projectId, environmentId },
    },
  })
  return created.key
}
