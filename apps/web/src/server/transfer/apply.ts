import { and, eq, inArray } from 'drizzle-orm'
import { type DbOrTx, db, type Transaction } from '@/db'
import {
  apikey,
  environments,
  experiments,
  flagEnvironments,
  flags,
  projects,
  segments,
} from '@/db/schema'
import type { Permissions } from '@/lib/permissions'
import { forbidden, HttpError } from '@/server/errors'
import { publish } from '@/server/events'
import { recordAudit } from '@/server/services/audit'
import {
  assertPermission,
  assertProjectAccess,
  auditActor,
  type ProjectActor,
} from '@/server/services/authz'
import {
  defaultEnvironmentConfig,
  type StoredEnvironmentConfig,
  toStoredConfig,
} from '@/server/services/flag-config'
import { one } from '@/server/services/util'
import {
  diffConfig,
  diffImport,
  type EntityDiff,
  hasChanges,
  type ImportChanges,
  type ImportDiff,
  sameRules,
} from './diff'
import {
  type ExportDocument,
  type ExportFlag,
  type ExportFlagEnvironment,
  exportProject,
  parseExportDocument,
} from './format'

export interface ImportOptions {
  projectId: string
  /** The raw document; it is validated here. */
  document: unknown
  prune?: boolean
}

export interface ImportPreview {
  diff: ImportChanges
  errors: string[]
  warnings: string[]
}

export interface ImportResult extends ImportPreview {
  applied: true
}

/** Thrown by {@link applyImport} when the document has problems; nothing was written. */
export class ImportRejectedError extends HttpError {
  readonly diff: ImportChanges
  readonly errors: string[]
  readonly warnings: string[]

  constructor(preview: ImportPreview) {
    super(
      422,
      'IMPORT_REJECTED',
      `The import was rejected, nothing was changed: ${preview.errors.slice(0, 5).join('; ')}${preview.errors.length > 5 ? `; and ${preview.errors.length - 5} more` : ''}`,
    )
    this.diff = preview.diff
    this.errors = preview.errors
    this.warnings = preview.warnings
  }

  override toResponse(): Response {
    return Response.json(
      {
        error: this.code,
        message: this.message,
        diff: this.diff,
        errors: this.errors,
        warnings: this.warnings,
        applied: false,
      },
      { status: this.status },
    )
  }
}

const EMPTY_CHANGES = (): ImportChanges => ({
  environments: { create: [], update: [], unchanged: 0, delete: [] },
  segments: { create: [], update: [], unchanged: 0, delete: [] },
  flags: { create: [], update: [], unchanged: 0, delete: [] },
})

const stripMessages = ({ warnings: _w, errors: _e, ...changes }: ImportDiff): ImportChanges =>
  changes

/** Service accounts (API keys, the scheduler) have no row in the user table. */
const API_KEY_PREFIX = 'apikey:'
const isAccount = (actor: ProjectActor) =>
  !actor.userId.startsWith(API_KEY_PREFIX) && actor.userId !== 'system'
const dbUserId = (actor: ProjectActor) => (isAccount(actor) ? actor.userId : null)

/** Audit identity of an actor; management keys are recorded as `api_key`. */
export function importAuditActor(actor: ProjectActor) {
  if (actor.userId.startsWith(API_KEY_PREFIX)) {
    return {
      type: 'api_key' as const,
      id: actor.userId.slice(API_KEY_PREFIX.length),
      name: actor.name,
    }
  }
  return auditActor(actor)
}

interface Plan {
  diff: ImportDiff
  document: ExportDocument | null
  current: ExportDocument | null
  errors: string[]
}

/** Permissions the actor needs for the changes in a diff, with a message for each. */
function requiredPermissions(
  changes: ImportChanges,
): { permissions: Permissions; message: string }[] {
  const needs: { permissions: Permissions; message: string }[] = []
  const add = (
    entity: 'environment' | 'segment' | 'flag',
    plural: string,
    diff: EntityDiff<unknown, unknown>,
  ) => {
    if (diff.create.length > 0) {
      needs.push({ permissions: { [entity]: ['create'] }, message: `create ${plural}` })
    }
    if (diff.update.length > 0) {
      needs.push({ permissions: { [entity]: ['update'] }, message: `update ${plural}` })
    }
    if (diff.delete.length > 0) {
      needs.push({ permissions: { [entity]: ['delete'] }, message: `delete ${plural}` })
    }
  }
  add('environment', 'environments', changes.environments)
  add('segment', 'segments', changes.segments)
  add('flag', 'flags', changes.flags)
  return needs
}

function permissionProblems(actor: ProjectActor, changes: ImportChanges): string[] {
  const problems: string[] = []
  for (const { permissions, message } of requiredPermissions(changes)) {
    try {
      assertPermission(actor, permissions)
    } catch {
      problems.push(`Your role is not allowed to ${message}`)
    }
  }
  return problems
}

/** Variants a running experiment still uses must not disappear. */
async function experimentProblems(
  executor: DbOrTx,
  projectId: string,
  current: ExportDocument,
  incoming: ExportDocument,
  diff: ImportDiff,
): Promise<string[]> {
  const removedByFlag = new Map<string, Set<string>>()
  for (const update of diff.flags.update) {
    if (!update.changes.some((c) => c.field === 'variants')) continue
    const before = current.flags.find((f) => f.key === update.key)
    const after = incoming.flags.find((f) => f.key === update.key)
    if (!before || !after) continue
    const kept = new Set(after.variants.map((v) => v.key))
    const removed = before.variants.map((v) => v.key).filter((key) => !kept.has(key))
    if (removed.length > 0) removedByFlag.set(update.key, new Set(removed))
  }
  if (removedByFlag.size === 0) return []

  const rows = await executor
    .select({
      flagKey: flags.key,
      key: experiments.key,
      allocation: experiments.allocation,
      controlVariant: experiments.controlVariant,
    })
    .from(experiments)
    .innerJoin(flags, eq(flags.id, experiments.flagId))
    .where(
      and(
        eq(experiments.projectId, projectId),
        eq(experiments.status, 'running'),
        inArray(flags.key, [...removedByFlag.keys()]),
      ),
    )
  const problems: string[] = []
  for (const row of rows) {
    const removed = removedByFlag.get(row.flagKey)
    if (!removed) continue
    for (const variant of removed) {
      if (row.controlVariant === variant || row.allocation.some((v) => v.variant === variant)) {
        problems.push(
          `Flag "${row.flagKey}": variant "${variant}" is removed but used by the running experiment "${row.key}"`,
        )
      }
    }
  }
  return problems
}

async function plan(executor: DbOrTx, options: ImportOptions): Promise<Plan> {
  const parsed = parseExportDocument(options.document)
  if (!parsed.ok) {
    return {
      diff: { ...EMPTY_CHANGES(), warnings: [], errors: parsed.errors },
      document: null,
      current: null,
      errors: parsed.errors,
    }
  }
  const current = await exportProject(options.projectId, executor)
  const diff = diffImport(current, parsed.document, { prune: options.prune ?? false })
  const errors = [
    ...diff.errors,
    ...(await experimentProblems(executor, options.projectId, current, parsed.document, diff)),
  ]
  return { diff, document: parsed.document, current, errors }
}

/** Computes what an import would change without writing anything. */
export async function previewImport(
  actor: ProjectActor,
  options: ImportOptions,
): Promise<ImportPreview> {
  assertProjectAccess(actor, options.projectId, { transfer: ['import'] })
  const { diff, errors } = await plan(db, options)
  const changes = stripMessages(diff)
  return {
    diff: changes,
    errors: [...errors, ...permissionProblems(actor, changes)],
    warnings: diff.warnings,
  }
}

/** API key metadata is stored as a JSON string, occasionally double-encoded by older plugin versions. */
function boundEnvironmentId(raw: string | null): string | undefined {
  let value: unknown = raw
  for (let i = 0; i < 2 && typeof value === 'string'; i += 1) {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  return value && typeof value === 'object'
    ? (value as { environmentId?: string }).environmentId
    : undefined
}

const environmentSnapshot = (env: {
  key: string
  name: string
  color: string
  isProduction: boolean
  sortOrder: number
}) => ({
  key: env.key,
  name: env.name,
  color: env.color,
  isProduction: env.isProduction,
  sortOrder: env.sortOrder,
})

const segmentSnapshot = (s: {
  key: string
  name: string
  description: string | null
  match: 'all' | 'any'
  conditions: unknown
}) => ({
  key: s.key,
  name: s.name,
  description: s.description,
  match: s.match,
  conditions: s.conditions,
})

const flagSnapshot = (f: typeof flags.$inferSelect) => ({
  key: f.key,
  name: f.name,
  description: f.description,
  type: f.type,
  variants: f.variants,
  tags: f.tags,
  archived: f.archivedAt !== null,
})

async function write(
  tx: Transaction,
  actor: ProjectActor,
  projectId: string,
  document: ExportDocument,
  diff: ImportDiff,
  prune: boolean,
  current: ExportDocument,
): Promise<void> {
  const auditBy = importAuditActor(actor)
  const userId = dbUserId(actor)
  let revokedKeys = false

  // Environments -------------------------------------------------------------
  for (const env of diff.environments.create) {
    const created = one(
      await tx
        .insert(environments)
        .values({
          projectId,
          key: env.key,
          name: env.name,
          color: env.color,
          isProduction: env.isProduction,
          sortOrder: env.sortOrder,
        })
        .returning(),
    )
    await recordAudit(tx, {
      projectId,
      environmentId: created.id,
      actor: auditBy,
      action: 'environment.created',
      entityType: 'environment',
      entityId: created.id,
      entityKey: created.key,
      after: environmentSnapshot(created),
    })
  }
  for (const update of diff.environments.update) {
    const [before] = await tx
      .select()
      .from(environments)
      .where(and(eq(environments.projectId, projectId), eq(environments.key, update.key)))
      .for('update')
    const target = document.environments.find((e) => e.key === update.key)
    if (!before || !target) continue
    const after = one(
      await tx
        .update(environments)
        .set({
          name: target.name,
          color: target.color,
          isProduction: target.isProduction,
          sortOrder: target.sortOrder,
        })
        .where(eq(environments.id, before.id))
        .returning(),
    )
    await recordAudit(tx, {
      projectId,
      environmentId: before.id,
      actor: auditBy,
      action: 'environment.updated',
      entityType: 'environment',
      entityId: before.id,
      entityKey: before.key,
      before: environmentSnapshot(before),
      after: environmentSnapshot(after),
    })
  }

  // Segments -----------------------------------------------------------------
  for (const segment of diff.segments.create) {
    const created = one(
      await tx
        .insert(segments)
        .values({
          projectId,
          key: segment.key,
          name: segment.name,
          description: segment.description,
          match: segment.match,
          conditions: segment.conditions,
        })
        .returning(),
    )
    await recordAudit(tx, {
      projectId,
      actor: auditBy,
      action: 'segment.created',
      entityType: 'segment',
      entityId: created.id,
      entityKey: created.key,
      after: segmentSnapshot(created),
    })
  }
  for (const update of diff.segments.update) {
    const [before] = await tx
      .select()
      .from(segments)
      .where(and(eq(segments.projectId, projectId), eq(segments.key, update.key)))
      .for('update')
    const target = document.segments.find((s) => s.key === update.key)
    if (!before || !target) continue
    const after = one(
      await tx
        .update(segments)
        .set({
          name: target.name,
          description: target.description,
          match: target.match,
          conditions: target.conditions,
        })
        .where(eq(segments.id, before.id))
        .returning(),
    )
    await recordAudit(tx, {
      projectId,
      actor: auditBy,
      action: 'segment.updated',
      entityType: 'segment',
      entityId: before.id,
      entityKey: before.key,
      before: segmentSnapshot(before),
      after: segmentSnapshot(after),
    })
  }

  // Flag definitions -----------------------------------------------------------
  const createdFlagKeys = new Set<string>()
  for (const flag of diff.flags.create) {
    const created = one(
      await tx
        .insert(flags)
        .values({
          projectId,
          key: flag.key,
          name: flag.name,
          description: flag.description,
          type: flag.type,
          variants: flag.variants,
          tags: flag.tags,
          archivedAt: flag.archived ? new Date() : null,
          createdBy: userId,
        })
        .returning(),
    )
    createdFlagKeys.add(flag.key)
    await recordAudit(tx, {
      projectId,
      actor: auditBy,
      action: 'flag.created',
      entityType: 'flag',
      entityId: created.id,
      entityKey: created.key,
      after: { ...flagSnapshot(created), environments: flag.environments },
    })
  }
  for (const update of diff.flags.update) {
    if (update.changes.length === 0) continue
    const target = document.flags.find((f) => f.key === update.key)
    const [before] = await tx
      .select()
      .from(flags)
      .where(and(eq(flags.projectId, projectId), eq(flags.key, update.key)))
      .for('update')
    if (!before || !target) continue
    const archivedChanged = (before.archivedAt !== null) !== target.archived
    const otherChanged = update.changes.some((c) => c.field !== 'archived')
    const after = one(
      await tx
        .update(flags)
        .set({
          name: target.name,
          description: target.description,
          variants: target.variants,
          tags: target.tags,
          archivedAt: archivedChanged ? (target.archived ? new Date() : null) : before.archivedAt,
        })
        .where(eq(flags.id, before.id))
        .returning(),
    )
    const entry = {
      projectId,
      actor: auditBy,
      entityType: 'flag' as const,
      entityId: before.id,
      entityKey: before.key,
      before: flagSnapshot(before),
      after: flagSnapshot(after),
    }
    if (otherChanged) await recordAudit(tx, { ...entry, action: 'flag.updated' })
    if (archivedChanged) {
      await recordAudit(tx, {
        ...entry,
        action: target.archived ? 'flag.archived' : 'flag.unarchived',
      })
    }
  }

  // Flag environment configurations -------------------------------------------
  const envRows = await tx.select().from(environments).where(eq(environments.projectId, projectId))
  const documentEnvKeys = new Set(document.environments.map((e) => e.key))
  const incomingFlags = new Map(document.flags.map((f) => [f.key, f]))
  const flagRows = await tx.select().from(flags).where(eq(flags.projectId, projectId)).for('update')
  const configRows = await tx
    .select({ row: flagEnvironments })
    .from(flagEnvironments)
    .innerJoin(flags, eq(flags.id, flagEnvironments.flagId))
    .where(eq(flags.projectId, projectId))
    .for('update', { of: flagEnvironments })
  const rowByKey = new Map(configRows.map(({ row }) => [`${row.flagId}:${row.environmentId}`, row]))

  const doomedFlags = new Set(diff.flags.delete.map((f) => f.key))
  const doomedEnvs = new Set(diff.environments.delete.map((e) => e.key))
  for (const flag of flagRows) {
    if (doomedFlags.has(flag.key)) continue
    const incoming: ExportFlag | undefined = incomingFlags.get(flag.key)
    for (const env of envRows) {
      if (doomedEnvs.has(env.key)) continue
      const target: ExportFlagEnvironment | undefined =
        incoming && documentEnvKeys.has(env.key) ? incoming.environments[env.key] : undefined
      const row = rowByKey.get(`${flag.id}:${env.id}`)
      const fallback = defaultEnvironmentConfig(flag)

      if (!row) {
        const config = target ?? fallback
        await tx.insert(flagEnvironments).values({
          flagId: flag.id,
          environmentId: env.id,
          updatedBy: userId,
          ...config,
        })
        if (target && !createdFlagKeys.has(flag.key) && diffConfig(fallback, target).length > 0) {
          await recordAudit(tx, {
            projectId,
            environmentId: env.id,
            actor: auditBy,
            action: 'flag.environment_updated',
            entityType: 'flag',
            entityId: flag.id,
            entityKey: flag.key,
            before: fallback,
            after: target,
          })
        }
        continue
      }

      if (!target) continue
      const before = toStoredConfig(row)
      if (diffConfig(before, target).length === 0) continue
      const next: StoredEnvironmentConfig = {
        enabled: target.enabled,
        offVariant: target.offVariant,
        fallthrough: target.fallthrough,
        // Rules that only differ in their ids keep the ids they have.
        rules: sameRules(before.rules, target.rules) ? before.rules : target.rules,
      }
      const updated = one(
        await tx
          .update(flagEnvironments)
          .set({ ...next, version: row.version + 1, updatedBy: userId })
          .where(eq(flagEnvironments.id, row.id))
          .returning(),
      )
      await recordAudit(tx, {
        projectId,
        environmentId: env.id,
        actor: auditBy,
        action: 'flag.environment_updated',
        entityType: 'flag',
        entityId: flag.id,
        entityKey: flag.key,
        before,
        after: toStoredConfig(updated),
      })
    }
  }

  // Deletions (prune) ----------------------------------------------------------
  for (const ref of diff.flags.delete) {
    const [flag] = await tx
      .select()
      .from(flags)
      .where(and(eq(flags.projectId, projectId), eq(flags.key, ref.key)))
      .for('update')
    if (!flag) continue
    await tx.delete(flags).where(eq(flags.id, flag.id))
    await recordAudit(tx, {
      projectId,
      actor: auditBy,
      action: 'flag.deleted',
      entityType: 'flag',
      entityId: flag.id,
      entityKey: flag.key,
      before: flagSnapshot(flag),
    })
  }
  for (const ref of diff.segments.delete) {
    const [segment] = await tx
      .select()
      .from(segments)
      .where(and(eq(segments.projectId, projectId), eq(segments.key, ref.key)))
      .for('update')
    if (!segment) continue
    await tx.delete(segments).where(eq(segments.id, segment.id))
    await recordAudit(tx, {
      projectId,
      actor: auditBy,
      action: 'segment.deleted',
      entityType: 'segment',
      entityId: segment.id,
      entityKey: segment.key,
      before: segmentSnapshot(segment),
    })
  }
  for (const ref of diff.environments.delete) {
    const [env] = await tx
      .select()
      .from(environments)
      .where(and(eq(environments.projectId, projectId), eq(environments.key, ref.key)))
      .for('update')
    if (!env) continue
    // SDK keys are bound to one environment and stop being useful once it is gone.
    const sdkKeys = await tx
      .select({ id: apikey.id, metadata: apikey.metadata })
      .from(apikey)
      .where(and(eq(apikey.referenceId, projectId), eq(apikey.configId, 'sdk')))
    for (const key of sdkKeys.filter((k) => boundEnvironmentId(k.metadata) === env.id)) {
      await tx.delete(apikey).where(eq(apikey.id, key.id))
      revokedKeys = true
    }
    await tx.delete(environments).where(eq(environments.id, env.id))
    await recordAudit(tx, {
      projectId,
      actor: auditBy,
      action: 'environment.deleted',
      entityType: 'environment',
      entityId: env.id,
      entityKey: env.key,
      before: environmentSnapshot(env),
    })
  }

  // Summary --------------------------------------------------------------------
  const count = (d: EntityDiff<unknown, unknown>) => ({
    created: d.create.length,
    updated: d.update.length,
    deleted: d.delete.length,
    unchanged: d.unchanged,
  })
  await recordAudit(tx, {
    projectId,
    actor: auditBy,
    action: 'import.applied',
    entityType: 'project',
    entityId: projectId,
    entityKey: current.project.slug,
    after: {
      prune,
      source: { slug: document.project.slug, exportedAt: document.exportedAt },
      environments: count(diff.environments),
      segments: count(diff.segments),
      flags: count(diff.flags),
    },
  })
  await publish({ type: 'ruleset.invalidate', projectId }, tx)
  if (revokedKeys) await publish({ type: 'apikey.invalidate' }, tx)
}

/**
 * Applies a document to a project in one transaction (environments, segments, flag
 * definitions, flag configurations, then deletions when pruning). The import is additive
 * unless `prune` is set. Nothing is written when the document has problems (422
 * `IMPORT_REJECTED`) or when it matches the project already.
 */
export async function applyImport(
  actor: ProjectActor,
  options: ImportOptions,
): Promise<ImportResult> {
  const { projectId } = options
  assertProjectAccess(actor, projectId, { transfer: ['import'] })
  const prune = options.prune ?? false

  return db.transaction(async (tx) => {
    // Imports of one project run one after the other.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update')

    const planned = await plan(tx, options)
    const changes = stripMessages(planned.diff)
    if (planned.errors.length > 0 || !planned.document || !planned.current) {
      throw new ImportRejectedError({
        diff: changes,
        errors: planned.errors,
        warnings: planned.diff.warnings,
      })
    }

    const denied = permissionProblems(actor, changes)
    if (denied.length > 0) throw forbidden(denied.join('; '))

    if (hasChanges(changes)) {
      await write(tx, actor, projectId, planned.document, planned.diff, prune, planned.current)
    }
    return { diff: changes, errors: [], warnings: planned.diff.warnings, applied: true }
  })
}
