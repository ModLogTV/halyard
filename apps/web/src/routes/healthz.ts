import { createFileRoute } from '@tanstack/react-router'
import { sql } from 'drizzle-orm'
import { db } from '@/db'

/** Liveness and readiness probe. Returns 503 while the database is unreachable. */
export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: async () => {
        try {
          await db.execute(sql`select 1`)
          return Response.json({ status: 'ok' })
        } catch (error) {
          return Response.json(
            { status: 'error', error: error instanceof Error ? error.message : 'unknown' },
            { status: 503 },
          )
        }
      },
    },
  },
})
