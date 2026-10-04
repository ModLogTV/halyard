import { runMigrations } from '../src/server/db/migrate'

await runMigrations()
process.exit(0)
