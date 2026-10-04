import type {
  Condition,
  ExperimentAllocation,
  FlagType,
  JsonValue,
  Rule,
  RolloutVariation,
  Serve,
  Variant,
} from '@halyard/engine'
import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

/**
 * A project is a better-auth organization. This table carries the project
 * specific settings; name, slug and membership live on `organization`.
 */
export const projects = pgTable('projects', {
  id: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  description: text(),
  /** Flags not evaluated for this many days are flagged as stale. */
  staleAfterDays: integer().notNull().default(30),
  /** Flags returning one variant for everyone for this many days are flagged as stale. */
  singleVariantAfterDays: integer().notNull().default(30),
  ...timestamps,
})

export const environments = pgTable(
  'environments',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    name: text().notNull(),
    /** Accent colour used in the UI, as a hex string such as `#f59e0b`. */
    color: text().notNull().default('#64748b'),
    /** Production environments get extra confirmation and visual treatment. */
    isProduction: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('environments_project_key_uidx').on(t.projectId, t.key)],
)

export const flagTypeEnum = pgEnum('flag_type', ['boolean', 'string', 'number', 'json'])

export const flags = pgTable(
  'flags',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    type: flagTypeEnum().$type<FlagType>().notNull(),
    variants: jsonb().$type<Variant[]>().notNull(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    archivedAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('flags_project_key_uidx').on(t.projectId, t.key),
    index('flags_project_idx').on(t.projectId),
  ],
)

export const flagEnvironments = pgTable(
  'flag_environments',
  {
    id: uuid().primaryKey().defaultRandom(),
    flagId: uuid()
      .notNull()
      .references(() => flags.id, { onDelete: 'cascade' }),
    environmentId: uuid()
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    enabled: boolean().notNull().default(false),
    offVariant: text().notNull(),
    fallthrough: jsonb().$type<Serve>().notNull(),
    rules: jsonb().$type<Rule[]>().notNull().default(sql`'[]'::jsonb`),
    /** Incremented on every change; used for optimistic concurrency and ETags. */
    version: integer().notNull().default(1),
    updatedBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('flag_environments_flag_env_uidx').on(t.flagId, t.environmentId),
    index('flag_environments_env_idx').on(t.environmentId),
  ],
)

export const segments = pgTable(
  'segments',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    match: text().$type<'all' | 'any'>().notNull().default('all'),
    conditions: jsonb().$type<Extract<Condition, { type: 'attribute' }>[]>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('segments_project_key_uidx').on(t.projectId, t.key)],
)

export const experimentStatusEnum = pgEnum('experiment_status', ['draft', 'running', 'stopped'])

export const experiments = pgTable(
  'experiments',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    flagId: uuid()
      .notNull()
      .references(() => flags.id, { onDelete: 'cascade' }),
    environmentId: uuid()
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    name: text().notNull(),
    hypothesis: text(),
    status: experimentStatusEnum().notNull().default('draft'),
    /** Weighted variants; weights add up to 100. */
    allocation: jsonb().$type<RolloutVariation[]>().notNull(),
    /** Name of the conversion event accepted by the tracking endpoint. */
    conversionEvent: text().notNull(),
    /** Variant treated as the baseline when computing lift and significance. */
    controlVariant: text().notNull(),
    startedAt: timestamp({ withTimezone: true }),
    stoppedAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('experiments_project_key_uidx').on(t.projectId, t.key),
    index('experiments_flag_env_idx').on(t.flagId, t.environmentId),
  ],
)

/** One row per (experiment, subject). Subjects are stored as a hash of the targeting key. */
export const experimentExposures = pgTable(
  'experiment_exposures',
  {
    experimentId: uuid()
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    subjectHash: text().notNull(),
    variant: text().notNull(),
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.experimentId, t.subjectHash] })],
)

export const experimentConversions = pgTable(
  'experiment_conversions',
  {
    experimentId: uuid()
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    subjectHash: text().notNull(),
    variant: text().notNull(),
    convertedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.experimentId, t.subjectHash] })],
)

export const scheduledChangeStatusEnum = pgEnum('scheduled_change_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
])

/** The partial configuration a scheduled change applies to a flag in one environment. */
export interface ScheduledChangePayload {
  enabled?: boolean
  fallthrough?: Serve
  rules?: Rule[]
}

export const scheduledChanges = pgTable(
  'scheduled_changes',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    flagId: uuid()
      .notNull()
      .references(() => flags.id, { onDelete: 'cascade' }),
    environmentId: uuid()
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp({ withTimezone: true }).notNull(),
    status: scheduledChangeStatusEnum().notNull().default('pending'),
    change: jsonb().$type<ScheduledChangePayload>().notNull(),
    /** Groups the steps of a staged rollout. */
    planId: uuid(),
    stepIndex: integer().notNull().default(0),
    note: text(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    executedAt: timestamp({ withTimezone: true }),
    error: text(),
    ...timestamps,
  },
  (t) => [
    index('scheduled_changes_due_idx').on(t.status, t.scheduledFor),
    index('scheduled_changes_flag_idx').on(t.flagId, t.environmentId),
  ],
)

/** Aggregated evaluation activity per flag and environment, written in batches. */
export const flagEvaluationStats = pgTable(
  'flag_evaluation_stats',
  {
    flagId: uuid()
      .notNull()
      .references(() => flags.id, { onDelete: 'cascade' }),
    environmentId: uuid()
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    lastEvaluatedAt: timestamp({ withTimezone: true }).notNull(),
    lastVariant: text(),
    /** Since when every evaluation returned `lastVariant`. */
    sameVariantSince: timestamp({ withTimezone: true }).notNull(),
    evaluationCount: bigint({ mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.flagId, t.environmentId] })],
)

export const auditActorTypeEnum = pgEnum('audit_actor_type', ['user', 'api_key', 'system'])

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: uuid().references(() => environments.id, { onDelete: 'set null' }),
    actorType: auditActorTypeEnum().notNull(),
    actorId: text(),
    actorName: text().notNull(),
    /** Dotted action such as `flag.updated` or `member.role_changed`. */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    entityKey: text(),
    before: jsonb().$type<JsonValue>(),
    after: jsonb().$type<JsonValue>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_project_created_idx').on(t.projectId, t.createdAt),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
)

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    url: text().notNull(),
    secret: text().notNull(),
    /** Event types this webhook subscribes to, e.g. `flag.updated`. `*` means all. */
    events: text().array().notNull(),
    enabled: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [index('webhooks_project_idx').on(t.projectId)],
)

export const deliveryStatusEnum = pgEnum('delivery_status', ['pending', 'success', 'failed'])

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid().primaryKey().defaultRandom(),
    webhookId: uuid()
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    eventType: text().notNull(),
    payload: jsonb().$type<JsonValue>().notNull(),
    status: deliveryStatusEnum().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastStatusCode: integer(),
    lastError: text(),
    lastResponseBody: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_webhook_idx').on(t.webhookId, t.createdAt),
  ],
)

// Relations -------------------------------------------------------------------

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organization, { fields: [projects.id], references: [organization.id] }),
  environments: many(environments),
  flags: many(flags),
  segments: many(segments),
}))

export const environmentsRelations = relations(environments, ({ one, many }) => ({
  project: one(projects, { fields: [environments.projectId], references: [projects.id] }),
  flagEnvironments: many(flagEnvironments),
}))

export const flagsRelations = relations(flags, ({ one, many }) => ({
  project: one(projects, { fields: [flags.projectId], references: [projects.id] }),
  environments: many(flagEnvironments),
  experiments: many(experiments),
}))

export const flagEnvironmentsRelations = relations(flagEnvironments, ({ one }) => ({
  flag: one(flags, { fields: [flagEnvironments.flagId], references: [flags.id] }),
  environment: one(environments, {
    fields: [flagEnvironments.environmentId],
    references: [environments.id],
  }),
}))

export const segmentsRelations = relations(segments, ({ one }) => ({
  project: one(projects, { fields: [segments.projectId], references: [projects.id] }),
}))

export const experimentsRelations = relations(experiments, ({ one }) => ({
  flag: one(flags, { fields: [experiments.flagId], references: [flags.id] }),
  environment: one(environments, {
    fields: [experiments.environmentId],
    references: [environments.id],
  }),
}))

export const scheduledChangesRelations = relations(scheduledChanges, ({ one }) => ({
  flag: one(flags, { fields: [scheduledChanges.flagId], references: [flags.id] }),
  environment: one(environments, {
    fields: [scheduledChanges.environmentId],
    references: [environments.id],
  }),
  creator: one(user, { fields: [scheduledChanges.createdBy], references: [user.id] }),
}))

export const webhooksRelations = relations(webhooks, ({ many }) => ({
  deliveries: many(webhookDeliveries),
}))

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, { fields: [webhookDeliveries.webhookId], references: [webhooks.id] }),
}))

export type ExperimentAllocationInput = ExperimentAllocation
