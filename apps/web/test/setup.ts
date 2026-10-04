import { Client } from 'pg'

/**
 * Backend tests run against a real Postgres database named `halyard_test` (override
 * with TEST_DATABASE_NAME), derived from DATABASE_URL. The database is created if missing and migrated
 * once per run; individual tests truncate the tables they touch via `resetDatabase`.
 */
const base = process.env.DATABASE_URL ?? 'postgresql://halyard:halyard@localhost:5432/halyard'
const url = new URL(base)
const adminUrl = new URL(base)
const testDbName = process.env.TEST_DATABASE_NAME ?? 'halyard_test'
url.pathname = `/${testDbName}`

process.env.DATABASE_URL = url.toString()
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
// Pinned instead of taken from the .env: the tests send requests to http://localhost:3000.
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
process.env.NODE_ENV = 'test'
process.env.RUN_MIGRATIONS_ON_STARTUP = 'false'
process.env.ENABLE_WORKERS = 'false'
// Tests create many accounts directly; the invite-only policy is covered by its own test.
process.env.AUTH_SIGNUP_MODE = 'open'

const admin = new Client({ connectionString: adminUrl.toString() })
await admin.connect()
const exists = await admin.query('select 1 from pg_database where datname = $1', [testDbName])
if (exists.rowCount === 0) await admin.query(`create database "${testDbName}"`)
await admin.end()

const { runMigrations } = await import('../src/server/db/migrate')
await runMigrations()
