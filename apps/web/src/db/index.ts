import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '@/lib/env'
import * as schema from './schema'

declare global {
  // Reused across HMR reloads in development so we do not leak connection pools.
  var __halyardPool: Pool | undefined
}

export const pool: Pool =
  globalThis.__halyardPool ??
  new Pool({
    connectionString: env().DATABASE_URL,
    max: 10,
  })
if (process.env.NODE_ENV !== 'production') globalThis.__halyardPool = pool

export const db = drizzle(pool, { schema, casing: 'snake_case' })
export type Database = typeof db
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DbOrTx = Database | Transaction
