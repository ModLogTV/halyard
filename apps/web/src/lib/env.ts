import { z } from 'zod'

const boolFromString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true')

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(16, 'BETTER_AUTH_SECRET must be at least 16 characters'),
  PORT: z.coerce.number().int().positive().default(3000),
  RUN_MIGRATIONS_ON_STARTUP: boolFromString,
  ENABLE_WORKERS: boolFromString,
  METRICS_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

/** Parse and cache process.env. Throws a readable error when required variables are missing. */
export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  cached = parsed.data
  return cached
}
