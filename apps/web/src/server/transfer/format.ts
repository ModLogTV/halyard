import type { AttributeCondition, FlagType, Rule, Serve, Variant } from '@modlogtv/halyard-engine'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type DbOrTx, db } from '@/db'
import {
  environments,
  flagEnvironments,
  flags,
  organization,
  projects,
  segments,
} from '@/db/schema'
import { notFound } from '@/server/errors'
import { withRuleIds } from '@/server/services/flag-config'
import {
  attributeConditionSchema,
  conditionSchema,
  HEX_COLOR_PATTERN,
  serveSchema,
  variantSchema,
} from '../schemas/common'
import { environmentKeySchema } from '../schemas/environments'

/**
 * Halyard export document, format version 1.
 *
 * A self-contained, deterministic description of a project's configuration: environments,
 * segments and flags with their per-environment targeting. It does not contain secrets,
 * evaluation statistics, experiments, schedules, members or API keys.
 */
export interface ExportEnvironment {
  key: string
  name: string
  color: string
  isProduction: boolean
  sortOrder: number
}

export interface ExportSegment {
  key: string
  name: string
  description: string | null
  match: 'all' | 'any'
  conditions: AttributeCondition[]
}

export interface ExportFlagEnvironment {
  enabled: boolean
  offVariant: string
  fallthrough: Serve
  rules: Rule[]
}

export interface ExportFlag {
  key: string
  name: string
  description: string | null
  type: FlagType
  variants: Variant[]
  tags: string[]
  archived: boolean
  /** Configuration per environment key. */
  environments: Record<string, ExportFlagEnvironment>
}

export interface ExportDocument {
  version: 1
  exportedAt: string
  project: { slug: string; name: string; description: string | null }
  environments: ExportEnvironment[]
  segments: ExportSegment[]
  flags: ExportFlag[]
}

const DEFAULT_COLOR = '#64748b'

const flagTypeSchema = z.enum(['boolean', 'string', 'number', 'json'])
const nullableText = z.string().max(2000).nullable()

const exportEnvironmentSchema = z.object({
  key: environmentKeySchema,
  name: z.string().trim().min(1, 'Name is required').max(200),
  color: z
    .string()
    .regex(HEX_COLOR_PATTERN, 'Color must be a hex value such as #3b82f6')
    .default(DEFAULT_COLOR),
  isProduction: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
})

const exportSegmentSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: nullableText.default(null),
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(attributeConditionSchema),
})

/** A rule as it appears in a document; `id` may be omitted by hand-written files. */
const exportRuleSchema = z.object({
  id: z.string().min(1).optional(),
  description: z.string().max(1000).optional(),
  conditions: z.array(conditionSchema),
  serve: serveSchema,
})

const exportFlagEnvironmentSchema = z.object({
  enabled: z.boolean(),
  offVariant: z.string().min(1),
  fallthrough: serveSchema,
  rules: z.array(exportRuleSchema).default([]),
})

const exportFlagSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: nullableText.default(null),
  type: flagTypeSchema,
  variants: z.array(variantSchema),
  tags: z.array(z.string()).max(50).default([]),
  archived: z.boolean().default(false),
  environments: z.record(z.string(), exportFlagEnvironmentSchema).default({}),
})

/**
 * Structure of an export document. Unknown extra keys are ignored. Key formats, variant
 * references, rollout weights and the like are checked afterwards with the engine
 * validators so that problems can be reported per flag.
 */
export const exportDocumentSchema = z.object({
  version: z.literal(1, 'Unsupported export format version, expected 1'),
  exportedAt: z.string(),
  project: z.object({
    slug: z.string(),
    name: z.string(),
    description: nullableText.default(null),
  }),
  environments: z.array(exportEnvironmentSchema),
  segments: z.array(exportSegmentSchema),
  flags: z.array(exportFlagSchema),
})

export type ParsedDocument =
  | { ok: true; document: ExportDocument }
  | { ok: false; errors: string[] }

const uniqueTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim()).filter(Boolean))]

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>(
    (out, part) =>
      typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part),
    '',
  )
}

/**
 * Parses an untrusted document: checks its structure and normalises it (trimmed and
 * de-duplicated tags, an id for every rule). Never throws.
 */
export function parseExportDocument(input: unknown): ParsedDocument {
  const result = exportDocumentSchema.safeParse(input)
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = formatPath(issue.path)
      return path ? `${path}: ${issue.message}` : issue.message
    })
    return { ok: false, errors: [...new Set(errors)].slice(0, 50) }
  }
  const parsed = result.data
  const document: ExportDocument = {
    version: 1,
    exportedAt: parsed.exportedAt,
    project: parsed.project,
    environments: parsed.environments,
    segments: parsed.segments as ExportSegment[],
    flags: parsed.flags.map((flag) => ({
      ...flag,
      tags: uniqueTags(flag.tags),
      variants: flag.variants as Variant[],
      environments: Object.fromEntries(
        Object.entries(flag.environments).map(([envKey, config]) => [
          envKey,
          { ...config, rules: withRuleIds(config.rules) },
        ]),
      ),
    })),
  }
  return { ok: true, document }
}

const byKey = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0

/**
 * Builds the export document of a project. Ordering is deterministic: environments by
 * sort order (then key), segments and flags by key. Archived flags are included.
 */
export async function exportProject(
  projectId: string,
  executor: DbOrTx = db,
): Promise<ExportDocument> {
  const [project] = await executor
    .select({
      slug: organization.slug,
      name: organization.name,
      description: projects.description,
    })
    .from(projects)
    .innerJoin(organization, eq(organization.id, projects.id))
    .where(eq(projects.id, projectId))
  if (!project) throw notFound('Project')

  const envRows = await executor
    .select()
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(asc(environments.sortOrder))
  envRows.sort((a, b) => a.sortOrder - b.sortOrder || byKey(a, b))
  const envKeyById = new Map(envRows.map((env) => [env.id, env.key]))

  const segmentRows = await executor
    .select()
    .from(segments)
    .where(eq(segments.projectId, projectId))
  segmentRows.sort(byKey)

  const flagRows = await executor.select().from(flags).where(eq(flags.projectId, projectId))
  flagRows.sort(byKey)

  const configRows = await executor
    .select({
      flagId: flagEnvironments.flagId,
      environmentId: flagEnvironments.environmentId,
      enabled: flagEnvironments.enabled,
      offVariant: flagEnvironments.offVariant,
      fallthrough: flagEnvironments.fallthrough,
      rules: flagEnvironments.rules,
    })
    .from(flagEnvironments)
    .innerJoin(flags, eq(flags.id, flagEnvironments.flagId))
    .where(eq(flags.projectId, projectId))
  const configsByFlag = new Map<string, typeof configRows>()
  for (const row of configRows) {
    const list = configsByFlag.get(row.flagId) ?? []
    list.push(row)
    configsByFlag.set(row.flagId, list)
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: { slug: project.slug, name: project.name, description: project.description },
    environments: envRows.map((env) => ({
      key: env.key,
      name: env.name,
      color: env.color,
      isProduction: env.isProduction,
      sortOrder: env.sortOrder,
    })),
    segments: segmentRows.map((segment) => ({
      key: segment.key,
      name: segment.name,
      description: segment.description,
      match: segment.match,
      conditions: segment.conditions,
    })),
    flags: flagRows.map((flag) => {
      const byEnvKey = new Map(
        (configsByFlag.get(flag.id) ?? []).map((row) => [envKeyById.get(row.environmentId), row]),
      )
      const configs: Record<string, ExportFlagEnvironment> = {}
      for (const env of envRows) {
        const row = byEnvKey.get(env.key)
        if (!row) continue
        configs[env.key] = {
          enabled: row.enabled,
          offVariant: row.offVariant,
          fallthrough: row.fallthrough,
          rules: row.rules,
        }
      }
      return {
        key: flag.key,
        name: flag.name,
        description: flag.description,
        type: flag.type,
        variants: flag.variants,
        tags: flag.tags,
        archived: flag.archivedAt !== null,
        environments: configs,
      }
    }),
  }
}
