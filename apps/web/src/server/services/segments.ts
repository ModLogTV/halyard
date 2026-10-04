import { type Segment, validateSegment } from '@modlogtv/halyard-engine'
import { and, asc, eq, sql } from 'drizzle-orm'
import { type DbOrTx, db } from '@/db'
import { segments } from '@/db/schema'
import { badRequest, conflict, HttpError, notFound } from '@/server/errors'
import { publish } from '@/server/events'
import {
  type CreateSegmentInput,
  createSegmentSchema,
  listSegmentsSchema,
  segmentRefSchema,
  type UpdateSegmentInput,
  updateSegmentSchema,
} from '../schemas/segments'
import { recordAudit } from './audit'
import { assertProjectAccess, auditActor, type ProjectActor } from './authz'
import { isUniqueViolation, jsonEqual, one, parseInput } from './util'

export type SegmentRecord = typeof segments.$inferSelect

export interface SegmentUsage {
  flagKey: string
  flagName: string
  environmentKey: string
  ruleId: string
  ruleIndex: number
}

export interface SegmentListItem extends SegmentRecord {
  usageCount: number
}

export interface SegmentDetail extends SegmentRecord {
  usages: SegmentUsage[]
}

/** Raised when a segment cannot be deleted because rules still reference it. */
export class SegmentInUseError extends HttpError {
  readonly usages: SegmentUsage[]

  constructor(segmentKey: string, usages: SegmentUsage[]) {
    super(
      409,
      'SEGMENT_IN_USE',
      `Segment "${segmentKey}" is used by ${usages.length} rule${usages.length === 1 ? '' : 's'}`,
    )
    this.usages = usages
  }

  override toResponse(): Response {
    return Response.json(
      { error: this.code, message: this.message, usages: this.usages },
      { status: this.status },
    )
  }
}

type UsageRow = SegmentUsage & { segmentKey: string }

/**
 * Finds every rule condition `{ type: 'segment', segmentKey }` in the project's flag
 * configurations (archived flags included, since they can be restored). Optionally
 * restricted to one segment.
 */
async function findUsages(
  executor: DbOrTx,
  projectId: string,
  segmentKey?: string,
): Promise<UsageRow[]> {
  const result = await executor.execute<{
    segment_key: string
    flag_key: string
    flag_name: string
    environment_key: string
    rule_id: string
    rule_index: number
  }>(sql`
    select distinct
      c.condition ->> 'segmentKey' as segment_key,
      f.key as flag_key,
      f.name as flag_name,
      e.key as environment_key,
      r.rule ->> 'id' as rule_id,
      (r.position - 1)::int as rule_index,
      e.sort_order,
      e.created_at
    from flag_environments fe
    join flags f on f.id = fe.flag_id
    join environments e on e.id = fe.environment_id
    cross join lateral jsonb_array_elements(fe.rules) with ordinality as r(rule, position)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.rule -> 'conditions') = 'array' then r.rule -> 'conditions' else '[]'::jsonb end
    ) as c(condition)
    where f.project_id = ${projectId}
      and c.condition ->> 'type' = 'segment'
      ${segmentKey === undefined ? sql`` : sql`and c.condition ->> 'segmentKey' = ${segmentKey}`}
    order by f.key, e.sort_order, e.created_at, rule_index
  `)
  return result.rows.map((row) => ({
    segmentKey: row.segment_key,
    flagKey: row.flag_key,
    flagName: row.flag_name,
    environmentKey: row.environment_key,
    ruleId: row.rule_id,
    ruleIndex: row.rule_index,
  }))
}

const asSegment = (s: Pick<SegmentRecord, 'key' | 'conditions' | 'match'>): Segment => ({
  key: s.key,
  conditions: s.conditions,
  match: s.match,
})

const snapshot = (s: SegmentRecord) => ({
  key: s.key,
  name: s.name,
  description: s.description,
  match: s.match,
  conditions: s.conditions,
})

async function findSegment(executor: DbOrTx, projectId: string, segmentKey: string) {
  const [segment] = await executor
    .select()
    .from(segments)
    .where(and(eq(segments.projectId, projectId), eq(segments.key, segmentKey)))
  if (!segment) throw notFound('Segment')
  return segment
}

export async function listSegments(
  actor: ProjectActor,
  input: { projectId: string },
): Promise<SegmentListItem[]> {
  const { projectId } = parseInput(listSegmentsSchema, input)
  assertProjectAccess(actor, projectId, { segment: ['read'] })
  const rows = await db
    .select()
    .from(segments)
    .where(eq(segments.projectId, projectId))
    .orderBy(asc(segments.key))
  const usages = await findUsages(db, projectId)
  return rows.map((segment) => ({
    ...segment,
    usageCount: usages.filter((u) => u.segmentKey === segment.key).length,
  }))
}

export async function getSegment(
  actor: ProjectActor,
  input: { projectId: string; segmentKey: string },
): Promise<SegmentDetail> {
  const { projectId, segmentKey } = parseInput(segmentRefSchema, input)
  assertProjectAccess(actor, projectId, { segment: ['read'] })
  const segment = await findSegment(db, projectId, segmentKey)
  const usages = await findUsages(db, projectId, segmentKey)
  return { ...segment, usages: usages.map(({ segmentKey: _key, ...usage }) => usage) }
}

export async function createSegment(
  actor: ProjectActor,
  input: CreateSegmentInput,
): Promise<SegmentRecord> {
  const data = parseInput(createSegmentSchema, input)
  assertProjectAccess(actor, data.projectId, { segment: ['create'] })

  const match = data.match ?? 'all'
  const segmentProblems = validateSegment({ key: data.key, match, conditions: data.conditions })
  if (segmentProblems.length > 0) throw badRequest(segmentProblems.join('; '))

  try {
    return await db.transaction(async (tx) => {
      const segment = one(
        await tx
          .insert(segments)
          .values({
            projectId: data.projectId,
            key: data.key,
            name: data.name,
            description: data.description ?? null,
            match,
            conditions: data.conditions,
          })
          .returning(),
      )
      await recordAudit(tx, {
        projectId: data.projectId,
        actor: auditActor(actor),
        action: 'segment.created',
        entityType: 'segment',
        entityId: segment.id,
        entityKey: segment.key,
        after: snapshot(segment),
      })
      await publish({ type: 'ruleset.invalidate', projectId: data.projectId }, tx)
      return segment
    })
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict(`A segment with the key "${data.key}" already exists`)
    throw error
  }
}

export async function updateSegment(
  actor: ProjectActor,
  input: UpdateSegmentInput,
): Promise<SegmentRecord> {
  const { projectId, segmentKey, patch } = parseInput(updateSegmentSchema, input)
  assertProjectAccess(actor, projectId, { segment: ['update'] })

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(segments)
      .where(and(eq(segments.projectId, projectId), eq(segments.key, segmentKey)))
      .for('update')
    if (!before) throw notFound('Segment')

    const next = {
      name: patch.name ?? before.name,
      description: patch.description === undefined ? before.description : patch.description,
      match: patch.match ?? before.match,
      conditions: patch.conditions ?? before.conditions,
    }
    const segmentProblems = validateSegment(asSegment({ key: before.key, ...next }))
    if (segmentProblems.length > 0) throw badRequest(segmentProblems.join('; '))

    if (
      next.name === before.name &&
      next.description === before.description &&
      next.match === before.match &&
      jsonEqual(next.conditions, before.conditions)
    ) {
      return before
    }

    const after = one(
      await tx.update(segments).set(next).where(eq(segments.id, before.id)).returning(),
    )
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'segment.updated',
      entityType: 'segment',
      entityId: after.id,
      entityKey: after.key,
      before: snapshot(before),
      after: snapshot(after),
    })
    await publish({ type: 'ruleset.invalidate', projectId }, tx)
    return after
  })
}

/** Deletes a segment; fails with 409 `SEGMENT_IN_USE` (listing the usages) while rules reference it. */
export async function deleteSegment(
  actor: ProjectActor,
  input: { projectId: string; segmentKey: string },
): Promise<{ id: string; key: string }> {
  const { projectId, segmentKey } = parseInput(segmentRefSchema, input)
  assertProjectAccess(actor, projectId, { segment: ['delete'] })

  return db.transaction(async (tx) => {
    const [segment] = await tx
      .select()
      .from(segments)
      .where(and(eq(segments.projectId, projectId), eq(segments.key, segmentKey)))
      .for('update')
    if (!segment) throw notFound('Segment')

    const usages = await findUsages(tx, projectId, segmentKey)
    if (usages.length > 0) {
      throw new SegmentInUseError(
        segmentKey,
        usages.map(({ segmentKey: _key, ...usage }) => usage),
      )
    }

    await tx.delete(segments).where(eq(segments.id, segment.id))
    await recordAudit(tx, {
      projectId,
      actor: auditActor(actor),
      action: 'segment.deleted',
      entityType: 'segment',
      entityId: segment.id,
      entityKey: segment.key,
      before: snapshot(segment),
    })
    await publish({ type: 'ruleset.invalidate', projectId }, tx)
    return { id: segment.id, key: segment.key }
  })
}
