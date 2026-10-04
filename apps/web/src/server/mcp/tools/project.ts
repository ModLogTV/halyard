import type { EvaluationContext } from '@modlogtv/halyard-engine'
import { z } from 'zod'
import { badRequest, notFound } from '@/server/errors'
import { evaluateForEnvironment } from '@/server/evaluation/evaluate'
import { listAuditLog, listFlagHistory } from '@/server/services/audit-log'
import { assertProjectAccess } from '@/server/services/authz'
import { listEnvironments } from '@/server/services/environments'
import { getProjectById } from '@/server/services/projects'
import { environmentKey, timestamp } from '../schemas'
import { defineTool, type ToolContext } from '../tools'

async function environmentByKey({ actor, projectId }: ToolContext, key: string) {
  const environments = await listEnvironments(actor, { projectId })
  const environment = environments.find((e) => e.key === key)
  if (!environment) throw notFound('Environment')
  return environment
}

export const projectTools = [
  defineTool({
    name: 'get_project',
    title: 'Get project',
    description:
      'The project this key belongs to, its environments and whether the key may write. Call this first to learn the environment keys.',
    kind: 'read',
    input: z.object({}),
    async run(_input, { actor, projectId }) {
      const project = await getProjectById(projectId)
      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        access: actor.role === 'viewer' ? 'read' : 'read_write',
        environments: project.environments.map((env) => ({
          key: env.key,
          name: env.name,
          isProduction: env.isProduction,
        })),
      }
    },
  }),

  defineTool({
    name: 'evaluate_flags',
    title: 'Evaluate flags',
    description:
      'Evaluates flags for an evaluation context in an environment, exactly as SDKs would, without recording anything. Use it to check targeting before or after a change.',
    kind: 'read',
    input: z.object({
      environmentKey,
      flagKey: z.string().min(1).optional().describe('Omit to evaluate every active flag'),
      context: z
        .record(z.string(), z.json())
        .describe('Evaluation context, for example { "targetingKey": "user-42", "plan": "pro" }'),
    }),
    async run(input, context) {
      const { actor, projectId } = context
      assertProjectAccess(actor, projectId, { playground: ['use'] })
      const environment = await environmentByKey(context, input.environmentKey)
      const evaluation = await evaluateForEnvironment({
        environmentId: environment.id,
        projectId,
        flagKey: input.flagKey,
        context: input.context as EvaluationContext,
        track: false,
      })
      if (!evaluation) throw badRequest('Could not load the environment configuration')
      return { environmentKey: environment.key, results: evaluation.results }
    },
  }),

  defineTool({
    name: 'list_audit_log',
    title: 'List audit log',
    description:
      'Who changed what and when, newest first. Pass `flagKey` for the history of one flag. Paginate with `nextCursor`.',
    kind: 'read',
    input: z.object({
      flagKey: z.string().min(1).optional().describe('Only entries about this flag'),
      environmentKey: environmentKey.optional().describe('Only entries about this environment'),
      action: z
        .string()
        .min(1)
        .optional()
        .describe('Exact action such as "flag.toggled", or a prefix such as "flag.*"'),
      from: timestamp.optional(),
      to: timestamp.optional(),
      cursor: z.string().min(1).optional().describe('`nextCursor` of the previous page'),
      limit: z.number().int().min(1).max(200).optional().describe('Page size (default 50)'),
    }),
    async run(input, context) {
      const { actor, projectId } = context
      const { flagKey, environmentKey: envKey, cursor, limit } = input
      if (flagKey) {
        if (envKey || input.action || input.from || input.to) {
          throw badRequest('Combine `flagKey` only with `cursor` and `limit`')
        }
        return listFlagHistory(actor, { projectId, flagKey, cursor, limit })
      }
      const environmentId = envKey ? (await environmentByKey(context, envKey)).id : undefined
      return listAuditLog(actor, {
        projectId,
        environmentId,
        action: input.action,
        from: input.from,
        to: input.to,
        cursor,
        limit,
      })
    },
  }),
]
