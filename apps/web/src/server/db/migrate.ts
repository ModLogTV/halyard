import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from '@/db'

/**
 * Finds the checked-in migrations folder. `MIGRATIONS_DIR` wins; otherwise the
 * usual locations are probed, because the bundled server lives in a different
 * directory than the source file.
 */
export function resolveMigrationsFolder(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    fileURLToPath(new URL('../../../drizzle', import.meta.url)),
    fileURLToPath(new URL('../drizzle', import.meta.url)),
    resolve(process.cwd(), 'drizzle'),
    resolve(process.cwd(), 'apps/web/drizzle'),
  ].filter((c): c is string => Boolean(c))
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'meta', '_journal.json'))) return candidate
  }
  throw new Error(
    `Could not locate the migrations folder. Looked in: ${candidates.join(', ')}. Set MIGRATIONS_DIR to the folder containing meta/_journal.json.`,
  )
}

/** Applies the checked-in Drizzle migrations. Safe to run concurrently; Drizzle locks the migrations table. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: resolveMigrationsFolder() })
}

export async function closeDatabase(): Promise<void> {
  await pool.end()
}
