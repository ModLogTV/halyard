import type {
  Condition,
  EvaluationContext,
  EvaluationDetails,
  FlagType,
  RolloutVariation,
  Serve,
  Variant,
} from '@halyard/engine'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { segments } from '@/db/schema'
import { badRequest, notFound } from '@/server/errors'
import { evaluateForEnvironment } from '@/server/evaluation/evaluate'
import { projectActor } from '@/server/request-actor'
import { projectIdSchema } from '@/server/schemas/common'
import { listEnvironments } from '@/server/services/environments'

const evaluatePlaygroundSchema = z.object({
  projectId: projectIdSchema,
  environmentKey: z.string().min(1),
  /** Omit to evaluate every non-archived flag of the environment. */
  flagKey: z.string().min(1).optional(),
  context: z.record(z.string(), z.json()),
})

export interface PlaygroundRule {
  id: string
  /** Zero based position in the rule list. */
  index: number
  description: string | null
  conditions: Condition[]
  serve: Serve
}

export type PlaygroundServedBy = 'off' | 'rule' | 'experiment' | 'fallthrough'

export interface PlaygroundFlagResult {
  flagKey: string
  /** Null when the flag does not exist in the evaluated ruleset. */
  flag: { type: FlagType; variants: Variant[] } | null
  details: EvaluationDetails
  /** The rule that matched, if any. */
  rule: PlaygroundRule | null
  /** Where the value came from. `null` for errors. */
  servedBy: PlaygroundServedBy | null
  /** The rollout the context was bucketed into (rule, experiment or fallthrough), for `SPLIT`. */
  variations: RolloutVariation[] | null
  /** Attribute the rollout buckets by (`targetingKey` unless configured otherwise). */
  bucketBy: string
  /** Matched segments with their display names. */
  matchedSegments: { key: string; name: string }[]
  /** Display names of every segment referenced by the matching rule. */
  segmentNames: Record<string, string>
}

export interface PlaygroundResult {
  environment: { key: string; name: string }
  results: PlaygroundFlagResult[]
}

/**
 * Evaluates a context against the live ruleset of an environment, exactly as
 * production would (same `evaluateForEnvironment`), but without recording
 * metrics, evaluation stats or experiment exposures.
 */
export const evaluatePlayground = createServerFn({ method: 'POST' })
  .validator(evaluatePlaygroundSchema)
  .handler(async ({ data }): Promise<PlaygroundResult> => {
    const actor = await projectActor(data.projectId, { playground: ['use'] })
    const environments = await listEnvironments(actor, { projectId: data.projectId })
    const environment = environments.find((e) => e.key === data.environmentKey)
    if (!environment) throw notFound('Environment')

    const evaluation = await evaluateForEnvironment({
      environmentId: environment.id,
      projectId: data.projectId,
      flagKey: data.flagKey,
      context: data.context as EvaluationContext,
      track: false,
    })
    if (!evaluation) throw badRequest('Could not load the environment configuration')

    const { ruleset } = evaluation.cached
    const referenced = new Set<string>()
    for (const details of evaluation.results) {
      for (const key of details.matchedSegments ?? []) referenced.add(key)
      const entry = ruleset.flags[details.flagKey]
      const rule = entry?.config.rules[details.ruleIndex ?? -1]
      for (const condition of rule?.conditions ?? []) {
        if (condition.type === 'segment') referenced.add(condition.segmentKey)
      }
    }
    const names = new Map<string, string>()
    if (referenced.size > 0) {
      const rows = await db
        .select({ key: segments.key, name: segments.name })
        .from(segments)
        .where(and(eq(segments.projectId, data.projectId), inArray(segments.key, [...referenced])))
      for (const row of rows) names.set(row.key, row.name)
    }
    const nameOf = (key: string) => names.get(key) ?? key

    const results = evaluation.results.map((details): PlaygroundFlagResult => {
      const entry = Object.hasOwn(ruleset.flags, details.flagKey)
        ? ruleset.flags[details.flagKey]
        : undefined
      const config = entry?.config
      const matched = config?.rules[details.ruleIndex ?? -1]
      const rule: PlaygroundRule | null =
        config && matched && details.ruleIndex !== undefined
          ? {
              id: matched.id,
              index: details.ruleIndex,
              description: matched.description?.trim() || null,
              conditions: matched.conditions,
              serve: matched.serve,
            }
          : null

      let servedBy: PlaygroundServedBy | null = null
      let variations: RolloutVariation[] | null = null
      let bucketBy = 'targetingKey'
      if (config && details.reason !== 'ERROR') {
        if (details.reason === 'DISABLED') servedBy = 'off'
        else if (rule) servedBy = 'rule'
        else if (details.experimentKey) servedBy = 'experiment'
        else servedBy = 'fallthrough'
        if (details.reason === 'SPLIT') {
          if (servedBy === 'rule' && rule?.serve.type === 'rollout') {
            variations = rule.serve.variations
            bucketBy = rule.serve.bucketBy ?? bucketBy
          } else if (servedBy === 'experiment') {
            variations = config.experiment?.variations ?? null
            bucketBy = config.experiment?.bucketBy ?? bucketBy
          } else if (config.fallthrough.type === 'rollout') {
            variations = config.fallthrough.variations
            bucketBy = config.fallthrough.bucketBy ?? bucketBy
          }
        }
      }

      const segmentNames: Record<string, string> = {}
      for (const condition of rule?.conditions ?? []) {
        if (condition.type === 'segment') {
          segmentNames[condition.segmentKey] = nameOf(condition.segmentKey)
        }
      }

      return {
        flagKey: details.flagKey,
        flag: entry ? { type: entry.flag.type, variants: entry.flag.variants } : null,
        details,
        rule,
        servedBy,
        variations,
        bucketBy,
        matchedSegments: (details.matchedSegments ?? []).map((key) => ({
          key,
          name: nameOf(key),
        })),
        segmentNames,
      }
    })

    return { environment: { key: environment.key, name: environment.name }, results }
  })
