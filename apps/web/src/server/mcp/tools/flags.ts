import { z } from 'zod'
import { COPYABLE_FIELDS, flagTypeSchema } from '@/server/schemas/flags'
import {
  archiveFlag,
  copyFlagEnvironment,
  createFlag,
  deleteFlag,
  getFlag,
  listFlags,
  toggleFlag,
  unarchiveFlag,
  updateFlag,
  updateFlagEnvironment,
} from '@/server/services/flags'
import {
  createFlagInput,
  environmentKey,
  flagKey,
  updateFlagEnvironmentInput,
  updateFlagInput,
} from '../schemas'
import { defineTool } from '../tools'

export const flagTools = [
  defineTool({
    name: 'list_flags',
    title: 'List flags',
    description:
      'Flags of the project with a summary per environment (enabled, fallthrough, rule count, version, last evaluation). Use get_flag for rules and variants.',
    kind: 'read',
    input: z.object({
      search: z.string().optional().describe('Matches key or name'),
      tags: z.array(z.string()).optional().describe('Flags carrying at least one of these tags'),
      type: flagTypeSchema.optional(),
      includeArchived: z.boolean().optional(),
    }),
    async run(input, { actor, projectId }) {
      const flags = await listFlags(actor, { projectId, ...input })
      return flags.map((flag) => ({
        key: flag.key,
        name: flag.name,
        description: flag.description,
        type: flag.type,
        tags: flag.tags,
        archived: flag.archivedAt !== null,
        environments: flag.environments.map((config) => {
          const stats = flag.stats.find((s) => s.environmentId === config.environmentId)
          return {
            environmentKey: config.environmentKey,
            enabled: config.enabled,
            fallthrough: config.fallthrough,
            ruleCount: config.ruleCount,
            version: config.version,
            lastEvaluatedAt: stats?.lastEvaluatedAt ?? null,
            evaluationCount: stats?.evaluationCount ?? 0,
          }
        }),
      }))
    },
  }),

  defineTool({
    name: 'get_flag',
    title: 'Get flag',
    description:
      'A flag with its variants and its full configuration (enabled, off variant, fallthrough, rules, version) in every environment.',
    kind: 'read',
    input: z.object({ flagKey }),
    run: ({ flagKey }, { actor, projectId }) => getFlag(actor, { projectId, flagKey }),
  }),

  defineTool({
    name: 'create_flag',
    title: 'Create flag',
    description:
      'Creates a flag. It starts disabled in every environment, serving its off variant; enable it per environment afterwards.',
    kind: 'create',
    input: createFlagInput,
    run: (input, { actor, projectId }) => createFlag(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'update_flag',
    title: 'Update flag',
    description:
      'Changes name, description, tags or variants of a flag (the definition shared by all environments). Omitted fields stay unchanged.',
    kind: 'update',
    input: updateFlagInput,
    run: ({ flagKey, ...patch }, { actor, projectId }) =>
      updateFlag(actor, { projectId, flagKey, patch }),
  }),

  defineTool({
    name: 'toggle_flag',
    title: 'Turn flag on or off',
    description:
      'Enables or disables a flag in one environment. A disabled flag serves its off variant to everyone.',
    kind: 'update',
    input: z.object({
      flagKey,
      environmentKey,
      enabled: z.boolean(),
      expectedVersion: updateFlagEnvironmentInput.shape.expectedVersion,
    }),
    run: (input, { actor, projectId }) => toggleFlag(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'update_flag_environment',
    title: 'Update flag targeting',
    description:
      'Changes the configuration of a flag in one environment: enabled, off variant, fallthrough and targeting rules. Omitted fields stay unchanged; `rules` replaces the whole list. Read the current configuration with get_flag first and pass its `version` as `expectedVersion`.',
    kind: 'update',
    input: updateFlagEnvironmentInput,
    run: ({ flagKey, environmentKey, expectedVersion, ...patch }, { actor, projectId }) =>
      updateFlagEnvironment(actor, { projectId, flagKey, environmentKey, expectedVersion, patch }),
  }),

  defineTool({
    name: 'promote_flag',
    title: 'Promote flag configuration',
    description:
      'Copies a flag configuration from one environment to another, for example from staging to production. Copies all fields unless `fields` is given.',
    kind: 'update',
    input: z.object({
      flagKey,
      fromEnvironmentKey: environmentKey.describe('Environment to copy from'),
      toEnvironmentKey: environmentKey.describe('Environment to copy to'),
      fields: z.array(z.enum(COPYABLE_FIELDS)).min(1).optional(),
    }),
    run: (input, { actor, projectId }) => copyFlagEnvironment(actor, { projectId, ...input }),
  }),

  defineTool({
    name: 'archive_flag',
    title: 'Archive flag',
    description:
      'Archives a flag: it disappears from SDK responses (clients fall back to their code default) but can be restored with unarchive_flag.',
    kind: 'update',
    input: z.object({ flagKey }),
    run: ({ flagKey }, { actor, projectId }) => archiveFlag(actor, { projectId, flagKey }),
  }),

  defineTool({
    name: 'unarchive_flag',
    title: 'Unarchive flag',
    description: 'Restores an archived flag with the configuration it had.',
    kind: 'update',
    input: z.object({ flagKey }),
    run: ({ flagKey }, { actor, projectId }) => unarchiveFlag(actor, { projectId, flagKey }),
  }),

  defineTool({
    name: 'delete_flag',
    title: 'Delete flag',
    description:
      'Permanently deletes a flag with its configuration, experiments and scheduled changes. Prefer archive_flag unless the user asks to delete.',
    kind: 'delete',
    input: z.object({ flagKey }),
    run: ({ flagKey }, { actor, projectId }) => deleteFlag(actor, { projectId, flagKey }),
  }),
]
