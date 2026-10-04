import type { EvaluationDetails } from '@modlogtv/halyard-engine'
import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client'
import { rulesetCacheStats } from '@/server/cache/ruleset-cache'

/**
 * Prometheus metrics for the evaluation path.
 *
 * Labels only ever carry configuration identifiers (project slug, environment key,
 * flag key, variant key, reason). Targeting keys and context attributes are never
 * used as labels: they are personal data and would explode cardinality.
 */
export type OfrepEndpoint = 'single' | 'bulk' | 'configuration' | 'ruleset' | 'track'

interface Metrics {
  registry: Registry
  evaluations: Counter<'project' | 'environment' | 'flag' | 'variant' | 'reason'>
  requestDuration: Histogram<'endpoint' | 'status'>
}

declare global {
  // Survives Vite HMR so metrics are registered exactly once per process.
  var __halyardMetrics: Metrics | undefined
}

/** Label used for flag keys that do not exist, so unknown keys sent by clients cannot add series. */
export const UNKNOWN_FLAG_LABEL = '_unknown'

function createMetrics(): Metrics {
  const registry = new Registry()
  collectDefaultMetrics({ register: registry })

  const evaluations = new Counter({
    name: 'halyard_evaluations_total',
    help: 'Flag evaluations served, by project, environment, flag, variant and reason',
    labelNames: ['project', 'environment', 'flag', 'variant', 'reason'] as const,
    registers: [registry],
  })

  const requestDuration = new Histogram({
    name: 'halyard_ofrep_request_duration_seconds',
    help: 'Duration of OFREP and ruleset requests',
    labelNames: ['endpoint', 'status'] as const,
    buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  })

  // The cache keeps plain counters; mirror them at scrape time.
  new Counter({
    name: 'halyard_ruleset_cache_hits_total',
    help: 'Ruleset cache lookups served from memory',
    registers: [registry],
    collect() {
      this.reset()
      this.inc(rulesetCacheStats.hits)
    },
  })
  new Counter({
    name: 'halyard_ruleset_cache_misses_total',
    help: 'Ruleset cache lookups that loaded the ruleset from Postgres',
    registers: [registry],
    collect() {
      this.reset()
      this.inc(rulesetCacheStats.misses)
    },
  })

  return { registry, evaluations, requestDuration }
}

globalThis.__halyardMetrics ??= createMetrics()
const metrics = globalThis.__halyardMetrics

/** Registry to expose on `/metrics` (`await registry.metrics()`, content type `registry.contentType`). */
export const registry: Registry = metrics.registry

/** Counts one evaluation. `project` is the project slug, `environment` the environment key. */
export function observeEvaluation(
  project: string,
  environment: string,
  details: EvaluationDetails,
): void {
  metrics.evaluations.inc({
    project,
    environment,
    flag: details.errorCode === 'FLAG_NOT_FOUND' ? UNKNOWN_FLAG_LABEL : details.flagKey,
    variant: details.variant ?? '',
    reason: details.reason,
  })
}

/** Records the duration of one request in seconds. */
export function observeRequest(endpoint: OfrepEndpoint, status: number, seconds: number): void {
  metrics.requestDuration.observe({ endpoint, status: String(status) }, seconds)
}
