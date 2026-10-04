import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from '@/db'

/** Applies the checked-in Drizzle migrations. Safe to run concurrently; Drizzle locks the migrations table. */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url))
  await migrate(db, { migrationsFolder })
}

export async function closeDatabase(): Promise<void> {
  await pool.end()
}
