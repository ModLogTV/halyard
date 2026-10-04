import {
  createEvaluator,
  type EvaluationContext,
  type EvaluationDetails,
  type Evaluator,
  type Ruleset,
} from '@modlogtv/halyard-engine'
import { type CachedRuleset, getRuleset } from '@/server/cache/ruleset-cache'
import { observeEvaluation } from './metrics'
import { recordEvaluation, recordExposure } from './tracking'

export interface EnvironmentEvaluation {
  cached: CachedRuleset
  /** One entry per evaluated flag, in ruleset order (a single entry when `flagKey` was given). */
  results: EvaluationDetails[]
}

// Evaluators are pure functions of the ruleset snapshot, so one per snapshot suffices.
const evaluators = new WeakMap<Ruleset, Evaluator>()

function evaluatorFor(ruleset: Ruleset): Evaluator {
  let evaluator = evaluators.get(ruleset)
  if (!evaluator) {
    evaluator = createEvaluator(ruleset)
    evaluators.set(ruleset, evaluator)
  }
  return evaluator
}

/**
 * Evaluates one flag (`flagKey`) or every flag of an environment for a context,
 * using the cached ruleset. Records metrics, evaluation stats and experiment
 * exposures in memory; nothing here waits on a database write.
 *
 * Pass `track: false` (the playground does) to skip metrics, stats and exposures.
 *
 * Returns null when the environment does not exist or, if `projectId` is given,
 * belongs to another project.
 */
export async function evaluateForEnvironment(options: {
  environmentId: string
  projectId?: string
  flagKey?: string
  context: EvaluationContext
  /** Record metrics, evaluation stats and exposures. Defaults to true. */
  track?: boolean
}): Promise<EnvironmentEvaluation | null> {
  const cached = await getRuleset(options.environmentId)
  if (!cached) return null
  if (options.projectId !== undefined && cached.projectId !== options.projectId) return null
  const evaluator = evaluatorFor(cached.ruleset)
  const results =
    options.flagKey === undefined
      ? Object.values(evaluator.evaluateAll(options.context))
      : [evaluator.evaluate(options.flagKey, options.context)]
  if (options.track !== false) {
    for (const details of results) record(cached, options.context, details)
  }
  return { cached, results }
}

function record(cached: CachedRuleset, context: EvaluationContext, details: EvaluationDetails) {
  const { ruleset } = cached
  observeEvaluation(ruleset.projectKey, ruleset.environmentKey, details)

  const flagId = Object.hasOwn(cached.flagIds, details.flagKey)
    ? cached.flagIds[details.flagKey]
    : undefined
  if (!flagId) return
  recordEvaluation(
    flagId,
    cached.environmentId,
    details.reason === 'ERROR' ? undefined : details.variant,
  )

  if (details.experimentKey && details.variant && typeof context.targetingKey === 'string') {
    const experimentId = Object.hasOwn(cached.experimentIds, details.experimentKey)
      ? cached.experimentIds[details.experimentKey]
      : undefined
    if (experimentId) recordExposure(experimentId, context.targetingKey, details.variant)
  }
}
