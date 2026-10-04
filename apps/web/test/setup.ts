import { Client } from 'pg'

/**
 * Backend tests run against a real Postgres database named `halyard_test`,
 * derived from DATABASE_URL. The database is created if missing and migrated
 * once per run; individual tests truncate the tables they touch via `resetDatabase`.
 */
const base = process.env.DATABASE_URL ?? 'postgresql://halyard:halyard@localhost:5433/halyard'
const url = new URL(base)
const adminUrl = new URL(base)
url.pathname = '/halyard_test'

process.env.DATABASE_URL = url.toString()
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NODE_ENV = 'test'
process.env.RUN_MIGRATIONS_ON_STARTUP = 'false'
process.env.ENABLE_WORKERS = 'false'

const admin = new Client({ connectionString: adminUrl.toString() })
await admin.connect()
const exists = await admin.query(`select 1 from pg_database where datname = 'halyard_test'`)
if (exists.rowCount === 0) await admin.query('create database halyard_test')
await admin.end()

const { runMigrations } = await import('../src/server/db/migrate')
await runMigrations()
