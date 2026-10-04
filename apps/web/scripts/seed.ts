/**
 * Seeds a local Halyard instance with demo data.
 *
 * Creates two users (an instance admin and a regular owner), the project
 * "Acme" with the default environments, segments, flags with targeting rules
 * and rollouts, SDK keys per environment and a management key. Re-running is
 * safe: when the project already exists the script leaves it untouched.
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '../src/db'
import { flagEvaluationStats, flags, organization, user } from '../src/db/schema'
import { auth } from '../src/lib/auth'
import { createManagementKey, createSdkKey } from '../src/server/services/api-keys'
import type { ProjectActorWithHeaders, UserActorWithHeaders } from '../src/server/services/authz'
import { createFlag, updateFlagEnvironment } from '../src/server/services/flags'
import { createProject } from '../src/server/services/projects'
import { createSegment } from '../src/server/services/segments'

const ADMIN = { name: 'Ada Admin', email: 'admin@example.com', password: 'password123' }
const OWNER = { name: 'Dana Developer', email: 'dev@example.com', password: 'password123' }

async function ensureUser(account: typeof ADMIN): Promise<UserActorWithHeaders> {
  const existing = await db.query.user.findFirst({ where: eq(user.email, account.email) })
  if (!existing) {
    await auth.api.signUpEmail({ body: account })
  }
  const response = await auth.api.signInEmail({
    body: { email: account.email, password: account.password },
    asResponse: true,
  })
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const row = await db.query.user.findFirst({ where: eq(user.email, account.email) })
  if (!row) throw new Error(`Could not create ${account.email}`)
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    isAdmin: row.role === 'admin',
    headers: new Headers({ cookie }),
  }
}

const admin = await ensureUser(ADMIN)
await db.update(user).set({ role: 'admin' }).where(eq(user.id, admin.userId))
const owner = await ensureUser(OWNER)

const existingProject = await db.query.organization.findFirst({
  where: eq(organization.slug, 'acme'),
})
if (existingProject) {
  console.log('Project "acme" already exists, nothing to seed.')
  process.exit(0)
}

const project = await createProject(owner, {
  name: 'Acme',
  slug: 'acme',
  description: 'Demo project with a few realistic flags.',
})
const actor: ProjectActorWithHeaders = { ...owner, projectId: project.id, role: 'owner' }
const env = (key: string) => {
  const e = project.environments.find((x) => x.key === key)
  if (!e) throw new Error(`missing environment ${key}`)
  return e
}
await auth.api.addMember({
  body: { organizationId: project.id, userId: admin.userId, role: 'editor' },
})

// Segments --------------------------------------------------------------------
await createSegment(actor, {
  projectId: project.id,
  key: 'beta-testers',
  name: 'Beta testers',
  description: 'Users who opted into the beta programme.',
  match: 'all',
  conditions: [{ type: 'attribute', attribute: 'beta', operator: 'eq', value: true }],
})
await createSegment(actor, {
  projectId: project.id,
  key: 'internal-users',
  name: 'Internal users',
  description: 'Everyone with a company email address.',
  match: 'all',
  conditions: [
    { type: 'attribute', attribute: 'email', operator: 'ends_with', value: '@acme.example' },
  ],
})
await createSegment(actor, {
  projectId: project.id,
  key: 'eu-customers',
  name: 'EU customers',
  match: 'all',
  conditions: [
    {
      type: 'attribute',
      attribute: 'country',
      operator: 'in',
      value: ['DE', 'FR', 'NL', 'AT', 'ES', 'IT', 'SE', 'PL'],
    },
  ],
})

// Flags -----------------------------------------------------------------------
await createFlag(actor, {
  projectId: project.id,
  key: 'checkout.new-payment-flow',
  name: 'New payment flow',
  description: 'Replaces the legacy checkout with the redesigned multi-step payment flow.',
  type: 'boolean',
  tags: ['checkout', 'q4'],
})
await updateFlagEnvironment(actor, {
  projectId: project.id,
  flagKey: 'checkout.new-payment-flow',
  environmentKey: 'development',
  patch: { enabled: true },
})
await updateFlagEnvironment(actor, {
  projectId: project.id,
  flagKey: 'checkout.new-payment-flow',
  environmentKey: 'staging',
  patch: {
    enabled: true,
    rules: [
      {
        id: crypto.randomUUID(),
        description: 'Internal users always see the new flow',
        conditions: [{ type: 'segment', segmentKey: 'internal-users' }],
        serve: { type: 'variant', variant: 'on' },
      },
    ],
    fallthrough: {
      type: 'rollout',
      variations: [
        { variant: 'on', weight: 50 },
        { variant: 'off', weight: 50 },
      ],
    },
  },
})
await updateFlagEnvironment(actor, {
  projectId: project.id,
  flagKey: 'checkout.new-payment-flow',
  environmentKey: 'production',
  patch: {
    enabled: true,
    rules: [
      {
        id: crypto.randomUUID(),
        description: 'Beta testers',
        conditions: [{ type: 'segment', segmentKey: 'beta-testers' }],
        serve: { type: 'variant', variant: 'on' },
      },
    ],
    fallthrough: {
      type: 'rollout',
      variations: [
        { variant: 'on', weight: 10 },
        { variant: 'off', weight: 90 },
      ],
    },
  },
})

await createFlag(actor, {
  projectId: project.id,
  key: 'pricing.plan-banner',
  name: 'Pricing page banner',
  description: 'Which promotional banner to show on the pricing page.',
  type: 'string',
  variants: [
    { key: 'none', value: 'none' },
    { key: 'annual-discount', value: 'Save 20% with annual billing' },
    { key: 'black-friday', value: 'Black Friday: 40% off the first year' },
  ],
  tags: ['marketing'],
  offVariant: 'none',
  defaultVariant: 'annual-discount',
})
await updateFlagEnvironment(actor, {
  projectId: project.id,
  flagKey: 'pricing.plan-banner',
  environmentKey: 'production',
  patch: {
    enabled: true,
    rules: [
      {
        id: crypto.randomUUID(),
        description: 'EU customers see the annual discount',
        conditions: [{ type: 'segment', segmentKey: 'eu-customers' }],
        serve: { type: 'variant', variant: 'annual-discount' },
      },
      {
        id: crypto.randomUUID(),
        description: 'US visitors get the seasonal campaign',
        conditions: [{ type: 'attribute', attribute: 'country', operator: 'eq', value: 'US' }],
        serve: { type: 'variant', variant: 'black-friday' },
      },
    ],
  },
})

await createFlag(actor, {
  projectId: project.id,
  key: 'search.results-per-page',
  name: 'Search results per page',
  type: 'number',
  variants: [
    { key: 'small', value: 10 },
    { key: 'medium', value: 25 },
    { key: 'large', value: 50 },
  ],
  tags: ['search', 'performance'],
  offVariant: 'medium',
  defaultVariant: 'medium',
})
await updateFlagEnvironment(actor, {
  projectId: project.id,
  flagKey: 'search.results-per-page',
  environmentKey: 'production',
  patch: {
    enabled: true,
    rules: [
      {
        id: crypto.randomUUID(),
        description: 'Large screens get more results',
        conditions: [
          { type: 'attribute', attribute: 'viewportWidth', operator: 'gte', value: 1440 },
        ],
        serve: { type: 'variant', variant: 'large' },
      },
    ],
  },
})

await createFlag(actor, {
  projectId: project.id,
  key: 'editor.toolbar-config',
  name: 'Editor toolbar configuration',
  description: 'Layout of the rich text editor toolbar.',
  type: 'json',
  variants: [
    { key: 'classic', value: { layout: 'single-row', items: ['bold', 'italic', 'link'] } },
    {
      key: 'compact',
      value: { layout: 'floating', items: ['bold', 'italic', 'link', 'code', 'ai'] },
    },
  ],
  tags: ['editor'],
  offVariant: 'classic',
  defaultVariant: 'compact',
})
await updateFlagEnvironment(actor, {
  projectId: project.id,
  flagKey: 'editor.toolbar-config',
  environmentKey: 'development',
  patch: { enabled: true },
})

await createFlag(actor, {
  projectId: project.id,
  key: 'legacy.export-csv',
  name: 'Legacy CSV export',
  description: 'Old export path kept for a few enterprise customers. Candidate for removal.',
  type: 'boolean',
  tags: ['legacy'],
})
for (const key of ['development', 'staging', 'production']) {
  await updateFlagEnvironment(actor, {
    projectId: project.id,
    flagKey: 'legacy.export-csv',
    environmentKey: key,
    patch: { enabled: true, fallthrough: { type: 'variant', variant: 'on' } },
  })
}

await createFlag(actor, {
  projectId: project.id,
  key: 'onboarding.checklist',
  name: 'Onboarding checklist',
  description: 'Shows the getting-started checklist to new workspaces.',
  type: 'boolean',
  tags: ['growth'],
})
await updateFlagEnvironment(actor, {
  projectId: project.id,
  flagKey: 'onboarding.checklist',
  environmentKey: 'production',
  patch: {
    enabled: true,
    fallthrough: {
      type: 'rollout',
      variations: [
        { variant: 'on', weight: 25 },
        { variant: 'off', weight: 75 },
      ],
    },
  },
})

// Evaluation stats to demonstrate stale flag detection -------------------------
const flagRows = await db.query.flags.findMany({
  where: (f, { eq }) => eq(f.projectId, project.id),
})
const flagId = (key: string) => {
  const f = flagRows.find((x) => x.key === key)
  if (!f) throw new Error(`missing flag ${key}`)
  return f.id
}
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000)
// Backdate two flags so the staleness thresholds apply to them.
await db
  .update(flags)
  .set({ createdAt: daysAgo(120) })
  .where(eq(flags.id, flagId('legacy.export-csv')))
await db
  .update(flags)
  .set({ createdAt: daysAgo(60) })
  .where(eq(flags.id, flagId('editor.toolbar-config')))
await db.insert(flagEvaluationStats).values([
  {
    flagId: flagId('checkout.new-payment-flow'),
    environmentId: env('production').id,
    lastEvaluatedAt: new Date(),
    lastVariant: 'on',
    sameVariantSince: new Date(),
    evaluationCount: 184_233,
  },
  {
    flagId: flagId('legacy.export-csv'),
    environmentId: env('production').id,
    lastEvaluatedAt: daysAgo(2),
    lastVariant: 'on',
    sameVariantSince: daysAgo(95),
    evaluationCount: 4_120,
  },
  {
    flagId: flagId('editor.toolbar-config'),
    environmentId: env('production').id,
    lastEvaluatedAt: daysAgo(48),
    lastVariant: 'classic',
    sameVariantSince: daysAgo(48),
    evaluationCount: 12,
  },
])

// API keys ----------------------------------------------------------------------
const keys: string[] = []
for (const e of project.environments) {
  const created = await createSdkKey(actor, {
    projectId: project.id,
    environmentId: e.id,
    name: `${e.name} SDK key`,
  })
  keys.push(`  ${e.key.padEnd(12)} ${created.key}`)
}
const management = await createManagementKey(actor, {
  projectId: project.id,
  name: 'CLI',
  access: 'write',
})

await db.execute(sql`select 1`)
console.log(`
Seeded project "Acme" (http://localhost:3000/app/acme)

Sign in with
  owner  ${OWNER.email} / ${OWNER.password}
  admin  ${ADMIN.email} / ${ADMIN.password}

SDK keys (one per environment)
${keys.join('\n')}

Management key (CLI)
  ${management.key}
`)
process.exit(0)
