import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { auditLog, environments, flagEnvironments, flags, segments } from '@/db/schema'
import { createEnvironment } from '@/server/services/environments'
import { createFlag, getFlag, updateFlagEnvironment } from '@/server/services/flags'
import { createSegment } from '@/server/services/segments'
import { applyImport, exportProject, previewImport } from '@/server/services/transfer'
import { ImportRejectedError } from '@/server/transfer/apply'
import { type ExportDocument, exportDocumentSchema } from '@/server/transfer/format'
import {
  captureEvents,
  createProjectFixture,
  type ProjectFixture,
  projectActorFor,
} from './factories'
import { resetDatabase } from './helpers'
import { seedProject } from './transfer-seed'

let source: ProjectFixture
let target: ProjectFixture
let events: ReturnType<typeof captureEvents>

afterEach(() => events.stop())

beforeEach(async () => {
  await resetDatabase()
  source = await createProjectFixture('source')
  target = await createProjectFixture('target')
  await seedProject(source)
  events = captureEvents()
})

const exportSource = () => exportProject(source.owner.actor, { projectId: source.projectId })
const exportTarget = () => exportProject(target.owner.actor, { projectId: target.projectId })
const preview = (document: unknown, prune = false) =>
  previewImport(target.owner.actor, { projectId: target.projectId, document, prune })
const apply = (document: unknown, prune = false, actor = target.owner.actor) =>
  applyImport(actor, { projectId: target.projectId, document, prune })

/** Documents equal except for the export timestamp and the project metadata. */
const comparable = (document: ExportDocument) => ({
  ...document,
  exportedAt: 'x',
  project: null,
})

const auditCount = async (projectId: string) =>
  (await db.select().from(auditLog).where(eq(auditLog.projectId, projectId))).length

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('exportProject', () => {
  it('exports a valid, deterministic document', async () => {
    const document = await exportSource()
    expect(exportDocumentSchema.safeParse(document).success).toBe(true)
    expect(document.version).toBe(1)
    expect(document.project).toEqual({ slug: 'source', name: 'Acme', description: null })
    expect(document.environments.map((e) => e.key)).toEqual([
      'development',
      'staging',
      'production',
    ])
    expect(document.environments[1]).toMatchObject({ name: 'Pre-production', color: '#a855f7' })
    expect(document.segments.map((s) => s.key)).toEqual(['beta-users', 'internal'])
    expect(document.flags.map((f) => f.key)).toEqual(['checkout', 'limits', 'plan', 'theme'])
    const theme = document.flags.find((f) => f.key === 'theme')
    expect(theme?.archived).toBe(true)

    const checkout = document.flags.find((f) => f.key === 'checkout')
    expect(Object.keys(checkout?.environments ?? {})).toEqual([
      'development',
      'staging',
      'production',
    ])
    expect(checkout?.environments.production).toMatchObject({
      enabled: true,
      offVariant: 'off',
      fallthrough: { type: 'rollout', bucketBy: 'userId' },
    })
    expect(checkout?.environments.production?.rules[0]).toMatchObject({
      id: expect.any(String),
      conditions: [{ type: 'segment', segmentKey: 'beta-users' }],
    })

    // Exports of an unchanged project are identical.
    const again = await exportSource()
    expect(comparable(again)).toEqual(comparable(document))
  })

  it('lets viewers export but not outsiders', async () => {
    await expect(
      exportProject(source.viewer.actor, { projectId: source.projectId }),
    ).resolves.toMatchObject({ version: 1 })
    const outsider = projectActorFor(source.outsider, 'Otto', source.projectId, 'viewer')
    // A forged role does not help: the actor is bound to another project.
    await expect(
      exportProject({ ...outsider, projectId: target.projectId }, { projectId: source.projectId }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('round trip', () => {
  it('imports an export into another project and exports the same document again', async () => {
    const document = await exportSource()

    const result = await preview(document)
    expect(result.errors).toEqual([])
    expect(result.diff.segments.create.map((s) => s.key)).toEqual(['beta-users', 'internal'])
    expect(result.diff.flags.create.map((f) => f.key)).toEqual([
      'checkout',
      'limits',
      'plan',
      'theme',
    ])
    expect(result.diff.flags.update).toEqual([])
    expect(result.diff.flags.delete).toEqual([])
    // Staging was renamed in the source; development and production already match.
    expect(result.diff.environments.create).toEqual([])
    expect(result.diff.environments.unchanged).toBe(2)
    expect(result.diff.environments.update).toEqual([
      {
        key: 'staging',
        name: 'Pre-production',
        changes: [
          { field: 'name', before: 'Staging', after: 'Pre-production' },
          { field: 'color', before: '#f59e0b', after: '#a855f7' },
        ],
      },
    ])
    // A preview writes nothing.
    expect(await db.select().from(flags).where(eq(flags.projectId, target.projectId))).toHaveLength(
      0,
    )

    const applied = await apply(document)
    expect(applied.applied).toBe(true)
    expect(applied.diff.flags.create).toHaveLength(4)

    const copy = await exportTarget()
    expect(comparable(copy)).toEqual(comparable(document))
    expect(copy.project.slug).toBe('target')

    // The rules kept the ids from the document.
    expect(copy.flags[0]?.environments.production?.rules[0]?.id).toBe(
      document.flags[0]?.environments.production?.rules[0]?.id,
    )
  })

  it('creates environments that do not exist yet, ordered as in the document', async () => {
    await createEnvironment(source.owner.actor, {
      projectId: source.projectId,
      key: 'qa',
      name: 'QA',
      color: '#10b981',
    })
    const document = await exportSource()
    const result = await preview(document)
    expect(result.diff.environments.create.map((e) => e.key)).toEqual(['qa'])

    await apply(document)
    expect(comparable(await exportTarget())).toEqual(comparable(document))
  })

  it('is idempotent: a second import changes and writes nothing', async () => {
    const document = await exportSource()
    await apply(document)

    const versions = async () =>
      (await db.select().from(flagEnvironments)).map((r) => [
        r.id,
        r.version,
        r.updatedAt.getTime(),
      ])
    const before = { audit: await auditCount(target.projectId), versions: await versions() }
    events.clear()

    const result = await preview(document)
    expect(result.errors).toEqual([])
    for (const entity of ['environments', 'segments', 'flags'] as const) {
      expect(result.diff[entity]).toMatchObject({ create: [], update: [], delete: [] })
    }
    expect(result.diff.flags.unchanged).toBe(4)
    expect(result.diff.segments.unchanged).toBe(2)
    expect(result.diff.environments.unchanged).toBe(3)

    const again = await apply(document)
    expect(again.applied).toBe(true)
    expect(await auditCount(target.projectId)).toBe(before.audit)
    expect(await versions()).toEqual(before.versions)
    expect(events.events).toEqual([])
  })

  it('ignores rule ids that differ and keeps the stored ones', async () => {
    const document = await exportSource()
    await apply(document)
    const stored = await exportTarget()

    const renumbered = clone(document)
    for (const flag of renumbered.flags) {
      for (const config of Object.values(flag.environments)) {
        for (const rule of config.rules) rule.id = `new-${rule.id}`
      }
    }
    const result = await preview(renumbered)
    expect(result.diff.flags.update).toEqual([])
    expect(result.diff.flags.unchanged).toBe(4)

    // A real change next to renamed ids keeps the stored ids of untouched rules.
    const changed = clone(renumbered)
    const checkout = changed.flags.find((f) => f.key === 'checkout')
    const production = checkout?.environments.production
    if (!production) throw new Error('missing config')
    production.enabled = false
    await apply(changed)
    const after = await exportTarget()
    expect(after.flags[0]?.environments.production?.enabled).toBe(false)
    expect(after.flags[0]?.environments.production?.rules).toEqual(
      stored.flags[0]?.environments.production?.rules,
    )
  })
})

describe('updates', () => {
  it('shows and applies exactly the changed rule and variant name', async () => {
    const document = await exportSource()
    await apply(document)
    const checkoutBefore = await getFlag(target.owner.actor, {
      projectId: target.projectId,
      flagKey: 'checkout',
    })
    const planBefore = await getFlag(target.owner.actor, {
      projectId: target.projectId,
      flagKey: 'plan',
    })
    const prodVersion = (detail: typeof checkoutBefore) =>
      detail.environments.find((e) => e.environmentKey === 'production')?.version

    const edited = clone(document)
    const checkout = edited.flags.find((f) => f.key === 'checkout')
    const rule = checkout?.environments.production?.rules[0]
    if (!rule) throw new Error('missing rule')
    rule.serve = { type: 'variant', variant: 'off' }
    const plan = edited.flags.find((f) => f.key === 'plan')
    const pro = plan?.variants.find((v) => v.key === 'pro')
    if (!pro) throw new Error('missing variant')
    pro.name = 'Professional'

    const result = await preview(edited)
    expect(result.errors).toEqual([])
    expect(result.diff.flags.create).toEqual([])
    expect(result.diff.flags.unchanged).toBe(2)
    expect(result.diff.flags.update).toHaveLength(2)
    expect(result.diff.flags.update.find((u) => u.key === 'checkout')).toMatchObject({
      changes: [],
      environments: [
        {
          environmentKey: 'production',
          changes: [
            {
              field: 'rules',
              before: [expect.objectContaining({ serve: { type: 'variant', variant: 'on' } })],
              after: [expect.objectContaining({ serve: { type: 'variant', variant: 'off' } })],
            },
          ],
        },
      ],
    })
    const planUpdate = result.diff.flags.update.find((u) => u.key === 'plan')
    expect(planUpdate?.environments).toEqual([])
    expect(planUpdate?.changes.map((c) => c.field)).toEqual(['variants'])
    expect(result.diff.segments.update).toEqual([])
    expect(result.diff.environments.update).toEqual([])

    events.clear()
    await apply(edited)

    const checkoutAfter = await getFlag(target.owner.actor, {
      projectId: target.projectId,
      flagKey: 'checkout',
    })
    const prod = checkoutAfter.environments.find((e) => e.environmentKey === 'production')
    expect(prod?.rules[0]?.serve).toEqual({ type: 'variant', variant: 'off' })
    expect(prodVersion(checkoutAfter)).toBe((prodVersion(checkoutBefore) ?? 0) + 1)
    // The other environments of the flag were not touched.
    expect(
      checkoutAfter.environments.find((e) => e.environmentKey === 'development')?.version,
    ).toBe(checkoutBefore.environments.find((e) => e.environmentKey === 'development')?.version)

    const planAfter = await getFlag(target.owner.actor, {
      projectId: target.projectId,
      flagKey: 'plan',
    })
    expect(planAfter.variants.find((v) => v.key === 'pro')?.name).toBe('Professional')
    expect(planAfter.environments.map((e) => e.version)).toEqual(
      planBefore.environments.map((e) => e.version),
    )

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.projectId, target.projectId))
      .orderBy(auditLog.createdAt)
    expect(
      rows
        .slice(-3)
        .map((r) => r.action)
        .sort(),
    ).toEqual(['flag.environment_updated', 'flag.updated', 'import.applied'])
    const updated = rows.find((r) => r.action === 'flag.updated')
    expect(updated).toMatchObject({ entityKey: 'plan', actorType: 'user' })
    expect(updated?.before).toMatchObject({ variants: expect.any(Array) })
    expect(updated?.after).toMatchObject({ variants: expect.any(Array) })
    const summary = rows.filter((r) => r.action === 'import.applied').at(-1)
    expect(summary?.after).toMatchObject({
      prune: false,
      flags: { created: 0, updated: 2, deleted: 0, unchanged: 2 },
    })
    expect(events.events).toEqual([{ type: 'ruleset.invalidate', projectId: target.projectId }])
  })

  it('renames a variant key together with its references in one import', async () => {
    const document = await exportSource()
    await apply(document)

    const edited = clone(document)
    const plan = edited.flags.find((f) => f.key === 'plan')
    if (!plan) throw new Error('missing flag')
    const pro = plan.variants.find((v) => v.key === 'pro')
    if (!pro) throw new Error('missing variant')
    pro.key = 'professional'
    for (const config of Object.values(plan.environments)) {
      for (const rule of config.rules) {
        if (rule.serve.type === 'variant' && rule.serve.variant === 'pro') {
          rule.serve.variant = 'professional'
        }
      }
    }
    const result = await apply(edited)
    expect(result.errors).toEqual([])
    const after = await exportTarget()
    expect(after.flags.find((f) => f.key === 'plan')?.variants.map((v) => v.key)).toEqual([
      'free',
      'professional',
      'team',
    ])
  })

  it('updates segments and archives or restores flags', async () => {
    const document = await exportSource()
    await apply(document)

    const edited = clone(document)
    const beta = edited.segments.find((s) => s.key === 'beta-users')
    if (!beta) throw new Error('missing segment')
    beta.match = 'any'
    beta.name = 'Betas'
    const theme = edited.flags.find((f) => f.key === 'theme')
    if (!theme) throw new Error('missing flag')
    theme.archived = false

    const result = await apply(edited)
    expect(result.diff.segments.update).toEqual([
      expect.objectContaining({ key: 'beta-users', changes: expect.any(Array) }),
    ])
    expect(result.diff.flags.update.map((u) => u.key)).toEqual(['theme'])
    const row = await db.query.flags.findFirst({
      where: and(eq(flags.projectId, target.projectId), eq(flags.key, 'theme')),
    })
    expect(row?.archivedAt).toBeNull()
    const actions = (
      await db.select().from(auditLog).where(eq(auditLog.projectId, target.projectId))
    ).map((a) => a.action)
    expect(actions).toContain('flag.unarchived')
    expect(actions).toContain('segment.updated')
  })

  it('applies the document configuration to flags that already exist with defaults', async () => {
    await createFlag(target.owner.actor, {
      projectId: target.projectId,
      key: 'checkout',
      name: 'Checkout',
      type: 'boolean',
    })
    const document = await exportSource()
    const result = await preview(document)
    expect(result.diff.flags.create.map((f) => f.key)).toEqual(['limits', 'plan', 'theme'])
    expect(result.diff.flags.update.map((u) => u.key)).toEqual(['checkout'])
    await apply(document)
    const copy = await exportTarget()
    expect(comparable(copy).flags[0]).toEqual(comparable(document).flags[0])
  })
})

describe('prune', () => {
  beforeEach(async () => {
    await apply(await exportSource())
    await createFlag(target.owner.actor, {
      projectId: target.projectId,
      key: 'legacy',
      name: 'Legacy',
      type: 'boolean',
    })
    await createSegment(target.owner.actor, {
      projectId: target.projectId,
      key: 'old-segment',
      name: 'Old',
      conditions: [],
    })
    await createEnvironment(target.owner.actor, {
      projectId: target.projectId,
      key: 'sandbox',
      name: 'Sandbox',
    })
  })

  const remaining = async () => ({
    flags: (await db.select().from(flags).where(eq(flags.projectId, target.projectId)))
      .map((f) => f.key)
      .sort(),
    segments: (await db.select().from(segments).where(eq(segments.projectId, target.projectId)))
      .map((s) => s.key)
      .sort(),
    environments: (
      await db.select().from(environments).where(eq(environments.projectId, target.projectId))
    )
      .map((e) => e.key)
      .sort(),
  })

  it('keeps everything that is missing from the document by default', async () => {
    const document = await exportSource()
    const result = await apply(document)
    expect(result.diff.flags.delete).toEqual([])
    expect(result.diff.segments.delete).toEqual([])
    expect(result.diff.environments.delete).toEqual([])
    const kept = await remaining()
    expect(kept.flags).toContain('legacy')
    expect(kept.segments).toContain('old-segment')
    expect(kept.environments).toContain('sandbox')
  })

  it('deletes flags, segments and environments missing from the document with prune', async () => {
    const document = await exportSource()
    const result = await preview(document, true)
    expect(result.diff.flags.delete).toEqual([{ key: 'legacy', name: 'Legacy' }])
    expect(result.diff.segments.delete).toEqual([{ key: 'old-segment', name: 'Old' }])
    expect(result.diff.environments.delete).toEqual([{ key: 'sandbox', name: 'Sandbox' }])
    expect(await remaining()).toMatchObject({ flags: expect.arrayContaining(['legacy']) })

    await apply(document, true)
    expect(await remaining()).toEqual({
      flags: ['checkout', 'limits', 'plan', 'theme'],
      segments: ['beta-users', 'internal'],
      environments: ['development', 'production', 'staging'],
    })
    const actions = (
      await db.select().from(auditLog).where(eq(auditLog.projectId, target.projectId))
    ).map((a) => a.action)
    expect(actions).toEqual(
      expect.arrayContaining(['flag.deleted', 'segment.deleted', 'environment.deleted']),
    )
    expect(comparable(await exportTarget())).toEqual(comparable(document))
  })

  it('refuses to delete every environment', async () => {
    const document = clone(await exportSource())
    document.environments = []
    for (const flag of document.flags) flag.environments = {}
    const result = await preview(document, true)
    expect(result.errors.join(' ')).toContain('every environment')
  })
})

describe('invalid documents', () => {
  const expectRejected = async (document: unknown, message: RegExp, prune = false) => {
    const before = {
      audit: await auditCount(target.projectId),
      flags: await db.select().from(flags).where(eq(flags.projectId, target.projectId)),
    }
    const result = await preview(document, prune)
    expect(result.errors.join('\n')).toMatch(message)
    const error = await apply(document, prune).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ImportRejectedError)
    expect((error as ImportRejectedError).status).toBe(422)
    expect((error as ImportRejectedError).errors.join('\n')).toMatch(message)
    expect(await auditCount(target.projectId)).toBe(before.audit)
    expect(await db.select().from(flags).where(eq(flags.projectId, target.projectId))).toEqual(
      before.flags,
    )
    return result
  }

  it('rejects rollout weights that do not add up to 100', async () => {
    const document = clone(await exportSource())
    const checkout = document.flags.find((f) => f.key === 'checkout')
    const production = checkout?.environments.production
    if (!production) throw new Error('missing config')
    production.fallthrough = {
      type: 'rollout',
      variations: [
        { variant: 'on', weight: 50 },
        { variant: 'off', weight: 40 },
      ],
    }
    const result = await expectRejected(
      document,
      /Flag "checkout", environment "production".*add up to 100/,
    )
    // Valid flags are reported as changes but nothing is applied while any problem remains.
    expect(result.diff.flags.create.map((f) => f.key)).toEqual(['limits', 'plan', 'theme'])
  })

  it('rejects unknown variants', async () => {
    const document = clone(await exportSource())
    const plan = document.flags.find((f) => f.key === 'plan')
    const staging = plan?.environments.staging
    if (!staging) throw new Error('missing config')
    staging.offVariant = 'enterprise'
    staging.fallthrough = { type: 'variant', variant: 'gold' }
    await expectRejected(
      document,
      /Flag "plan", environment "staging": Off variant "enterprise" does not exist/,
    )
  })

  it('rejects invalid keys', async () => {
    const document = clone(await exportSource())
    const flag = document.flags[0]
    if (!flag) throw new Error('missing flag')
    flag.key = 'not a key!'
    await expectRejected(document, /Flag key "not a key!" is invalid/)
  })

  it('rejects unknown segments, duplicate keys and type changes', async () => {
    const document = clone(await exportSource())
    const checkout = document.flags.find((f) => f.key === 'checkout')
    const rule = checkout?.environments.production?.rules[0]
    if (!rule) throw new Error('missing rule')
    rule.conditions = [{ type: 'segment', segmentKey: 'ghosts' }]
    await expectRejected(document, /segment "ghosts" does not exist/)

    const duplicated = clone(await exportSource())
    duplicated.flags.push(clone(duplicated.flags[0] as ExportDocument['flags'][number]))
    await expectRejected(duplicated, /Flag "checkout" appears more than once/)

    await apply(await exportSource())
    const retyped = clone(await exportSource())
    const plan = retyped.flags.find((f) => f.key === 'plan')
    if (!plan) throw new Error('missing flag')
    plan.type = 'json'
    await expectRejected(retyped, /Flag "plan": the type cannot change/)
  })

  it('rejects documents that are not export documents', async () => {
    await expectRejected({ version: 2 }, /version/)
    await expectRejected('nope', /./)
    await expectRejected({ ...(await exportSource()), flags: [{ key: 'x' }] }, /flags\[0\]/)
  })

  it('does not let a removed variant break configurations the document leaves alone', async () => {
    await apply(await exportSource())
    const document = clone(await exportSource())
    const plan = document.flags.find((f) => f.key === 'plan')
    if (!plan) throw new Error('missing flag')
    plan.variants = plan.variants.filter((v) => v.key !== 'team')
    // The staging rule serving "team" is part of the document and still references it.
    await expectRejected(document, /Flag "plan", environment "staging".*"team" does not exist/)

    // When the document does not configure the environment, the stored configuration blocks it.
    delete plan.environments.staging
    await expectRejected(
      document,
      /variant "team" is removed but still used by rule 2 .* in environment "staging"/,
    )
  })
})

describe('warnings', () => {
  it('skips configurations of environments the document does not define', async () => {
    const document = clone(await exportSource())
    document.environments = document.environments.filter((e) => e.key !== 'staging')
    const result = await preview(document)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([
      'Environment "staging" is not defined in the document; its configuration is skipped for 4 flags (checkout, limits, plan, ...)',
    ])
    await apply(document)
    const staging = await getFlag(target.owner.actor, {
      projectId: target.projectId,
      flagKey: 'plan',
    })
    // The staging configuration of the new flag is the default, not the one from the document.
    expect(staging.environments.find((e) => e.environmentKey === 'staging')).toMatchObject({
      enabled: false,
      rules: [],
    })
  })

  it('warns when a new flag has no configuration for a document environment', async () => {
    const document = clone(await exportSource())
    const limits = document.flags.find((f) => f.key === 'limits')
    if (!limits) throw new Error('missing flag')
    delete limits.environments.development
    const result = await preview(document)
    expect(result.warnings).toEqual([
      'Flag "limits" has no configuration for environment "development"; it is created disabled with default targeting there',
    ])
  })
})

describe('authorization', () => {
  it('does not let viewers import or preview', async () => {
    const document = await exportSource()
    const viewer = projectActorFor(target.viewer.user, 'Vera', target.projectId, 'viewer')
    await expect(
      previewImport(viewer, { projectId: target.projectId, document }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      applyImport(viewer, { projectId: target.projectId, document }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await db.select().from(flags).where(eq(flags.projectId, target.projectId))).toHaveLength(
      0,
    )
  })

  it('lets editors import documents that do not touch environments', async () => {
    const document = clone(await exportSource())
    document.environments = (await exportTarget()).environments
    const result = await apply(document, false, target.editor.actor)
    expect(result.applied).toBe(true)
    expect(result.diff.flags.create).toHaveLength(4)
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'import.applied'))
    expect(rows[0]).toMatchObject({ actorType: 'user', actorId: target.editor.user.id })
  })

  it('needs the entity permissions of the changes: editors cannot create or delete environments', async () => {
    await createEnvironment(source.owner.actor, {
      projectId: source.projectId,
      key: 'qa',
      name: 'QA',
    })
    const document = await exportSource()
    const result = await previewImport(target.editor.actor, {
      projectId: target.projectId,
      document,
    })
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/not allowed to create environments/)]),
    )
    await expect(apply(document, false, target.editor.actor)).rejects.toMatchObject({ status: 403 })
    expect(await db.select().from(flags).where(eq(flags.projectId, target.projectId))).toHaveLength(
      0,
    )

    await apply(document)
    const pruneDoc = clone(document)
    pruneDoc.environments = pruneDoc.environments.filter((e) => e.key !== 'qa')
    for (const flag of pruneDoc.flags) delete flag.environments.qa
    await expect(apply(pruneDoc, true, target.editor.actor)).rejects.toMatchObject({ status: 403 })
    await expect(apply(pruneDoc, true)).resolves.toMatchObject({ applied: true })
  })

  it('refuses actors of another project', async () => {
    const document = await exportSource()
    await expect(
      applyImport(source.owner.actor, { projectId: target.projectId, document }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('records management keys as api_key actors and does not need a user row', async () => {
    const document = await exportSource()
    const keyActor = {
      ...target.editor.actor,
      userId: 'apikey:key_123',
      name: 'CI key',
      email: '',
    }
    document.environments = (await exportTarget()).environments
    await apply(document, false, keyActor)
    const rows = await db.select().from(auditLog).where(eq(auditLog.projectId, target.projectId))
    const import_ = rows.find((r) => r.action === 'import.applied')
    expect(import_).toMatchObject({ actorType: 'api_key', actorId: 'key_123', actorName: 'CI key' })
    expect(
      rows.filter((r) => r.action === 'flag.created').every((r) => r.actorType === 'api_key'),
    ).toBe(true)
    const created = await db.select().from(flags).where(eq(flags.projectId, target.projectId))
    expect(created.every((f) => f.createdBy === null)).toBe(true)
    const configs = await db
      .select({ updatedBy: flagEnvironments.updatedBy })
      .from(flagEnvironments)
      .innerJoin(flags, eq(flags.id, flagEnvironments.flagId))
      .where(eq(flags.projectId, target.projectId))
    expect(configs).toHaveLength(12)
    expect(configs.every((c) => c.updatedBy === null)).toBe(true)
  })
})

describe('services stay consistent with imports', () => {
  it('lets the regular services work on imported data', async () => {
    await apply(await exportSource())
    const updated = await updateFlagEnvironment(target.owner.actor, {
      projectId: target.projectId,
      flagKey: 'plan',
      environmentKey: 'staging',
      patch: { enabled: false },
    })
    expect(updated.enabled).toBe(false)
    expect(updated.rules).toHaveLength(2)
    expect(updated.version).toBe(2)
  })
})
