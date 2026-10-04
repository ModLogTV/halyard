import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { auth } from '@/lib/auth'
import { clearApiKeyCache } from '@/server/auth/api-key'
import { clearRulesetCache } from '@/server/cache/ruleset-cache'

/** Truncates every application table. Call in `beforeEach`. */
export async function resetDatabase(): Promise<void> {
  await db.execute(sql`
    truncate table
      "audit_log", "webhook_deliveries", "webhooks", "scheduled_changes",
      "flag_evaluation_stats", "experiment_conversions", "experiment_exposures", "experiments",
      "flag_environments", "flags", "segments", "environments", "projects",
      "apikey", "invitation", "member", "organization",
      "verification", "account", "session", "user"
    restart identity cascade
  `)
  clearApiKeyCache()
  clearRulesetCache()
}

export interface TestUser {
  id: string
  email: string
  headers: Headers
}

let counter = 0

/** Creates a user through better-auth and returns headers carrying its session cookie. */
export async function createTestUser(
  overrides: { name?: string; email?: string } = {},
): Promise<TestUser> {
  counter += 1
  const email = overrides.email ?? `user${counter}-${Date.now()}@example.com`
  const response = await auth.api.signUpEmail({
    body: { name: overrides.name ?? `User ${counter}`, email, password: 'password123' },
    asResponse: true,
  })
  const cookies = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const body = (await response.json()) as { user: { id: string } }
  return { id: body.user.id, email, headers: new Headers({ cookie: cookies }) }
}
