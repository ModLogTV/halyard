import { and, desc, eq, gte, like, lte, type SQL, sql } from 'drizzle-orm'
import { db } from '@/db'
import { auditLog, flags } from '@/db/schema'
import { badRequest, notFound } from '@/server/errors'
import { type ListAuditLogInput, listAuditLogSchema, listFlagHistorySchema } from '../schemas/audit'
import { assertProjectAccess, type ProjectActor } from './authz'
import { parseInput } from './util'

export type AuditLogEntry = typeof auditLog.$inferSelect

export interface AuditLogPage {
  items: AuditLogEntry[]
  /** Pass as `cursor` to fetch the next page; null on the last page. */
  nextCursor: string | null
}

const DEFAULT_LIMIT = 50

interface Cursor {
  /** Postgres text rendering of `created_at`, which keeps microsecond precision. */
  createdAt: string
  id: string
}

const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url')

function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id }
    }
  } catch {
    // fall through
  }
  throw badRequest('Invalid cursor')
}

async function queryAuditLog(
  projectId: string,
  filters: SQL[],
  cursor: string | undefined,
  limit: number,
): Promise<AuditLogPage> {
  const conditions = [eq(auditLog.projectId, projectId), ...filters]
  if (cursor) {
    const c = decodeCursor(cursor)
    conditions.push(
      sql`(${auditLog.createdAt}, ${auditLog.id}) < (${c.createdAt}::timestamptz, ${c.id}::uuid)`,
    )
  }

  const rows = await db
    .select({ entry: auditLog, cursorTs: sql<string>`${auditLog.createdAt}::text` })
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map((r) => r.entry),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.cursorTs, id: last.entry.id })
        : null,
  }
}

/** Newest first, keyset-paginated on `(created_at, id)`. */
export async function listAuditLog(
  actor: ProjectActor,
  input: ListAuditLogInput,
): Promise<AuditLogPage> {
  const query = parseInput(listAuditLogSchema, input)
  assertProjectAccess(actor, query.projectId, { audit: ['read'] })

  const filters: SQL[] = []
  if (query.environmentId) filters.push(eq(auditLog.environmentId, query.environmentId))
  if (query.entityType) filters.push(eq(auditLog.entityType, query.entityType))
  if (query.entityId) filters.push(eq(auditLog.entityId, query.entityId))
  if (query.actorId) filters.push(eq(auditLog.actorId, query.actorId))
  if (query.action) {
    filters.push(
      query.action.endsWith('*')
        ? like(auditLog.action, `${query.action.slice(0, -1).replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
        : eq(auditLog.action, query.action),
    )
  }
  if (query.from) filters.push(gte(auditLog.createdAt, query.from))
  if (query.to) filters.push(lte(auditLog.createdAt, query.to))

  return queryAuditLog(query.projectId, filters, query.cursor, query.limit ?? DEFAULT_LIMIT)
}

/** The audit trail of one flag, newest first. */
export async function listFlagHistory(
  actor: ProjectActor,
  input: { projectId: string; flagKey: string; cursor?: string; limit?: number },
): Promise<AuditLogPage> {
  const query = parseInput(listFlagHistorySchema, input)
  assertProjectAccess(actor, query.projectId, { audit: ['read'] })

  const [flag] = await db
    .select({ id: flags.id })
    .from(flags)
    .where(and(eq(flags.projectId, query.projectId), eq(flags.key, query.flagKey)))
  if (!flag) throw notFound('Flag')

  return queryAuditLog(
    query.projectId,
    [eq(auditLog.entityType, 'flag'), eq(auditLog.entityId, flag.id)],
    query.cursor,
    query.limit ?? DEFAULT_LIMIT,
  )
}
