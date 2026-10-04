/**
 * Core data model shared by the Halyard server, the UI playground, the CLI and
 * any client evaluating a downloaded ruleset locally.
 *
 * Everything in here is plain JSON-serialisable data.
 */

/** Any JSON value. Flag variants hold values of this type. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type FlagType = 'boolean' | 'string' | 'number' | 'json'

/** A named value a flag can resolve to. Variant keys are unique within a flag. */
export interface Variant {
  key: string
  value: JsonValue
  /** Optional human readable name shown in the UI. */
  name?: string
  description?: string
}

/** Project-wide definition of a flag. Environment-specific behaviour lives in {@link FlagEnvironmentConfig}. */
export interface FlagDefinition {
  key: string
  type: FlagType
  variants: Variant[]
}

/**
 * Operators available for attribute conditions.
 *
 * - `in` / `not_in` expect `value` to be an array.
 * - `contains` / `not_contains` / `starts_with` / `ends_with` operate on strings. When the
 *   context attribute is an array, `contains` checks array membership.
 * - `gt` / `gte` / `lt` / `lte` compare numbers (strings that parse as numbers are accepted).
 * - `semver_*` compare semantic version strings such as `1.2.3`.
 * - `regex` tests the attribute against a regular expression given as a string.
 * - `exists` / `not_exists` ignore `value`.
 */
export type Operator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'regex'
  | 'exists'
  | 'not_exists'
  | 'semver_eq'
  | 'semver_gt'
  | 'semver_gte'
  | 'semver_lt'
  | 'semver_lte'

export const OPERATORS: readonly Operator[] = [
  'eq',
  'neq',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'regex',
  'exists',
  'not_exists',
  'semver_eq',
  'semver_gt',
  'semver_gte',
  'semver_lt',
  'semver_lte',
]

/** Matches an attribute of the evaluation context. `targetingKey` is addressable as an attribute too. */
export interface AttributeCondition {
  type: 'attribute'
  attribute: string
  operator: Operator
  value?: JsonValue
}

/** Matches when the context belongs to (or, with `negate`, does not belong to) a segment. */
export interface SegmentCondition {
  type: 'segment'
  segmentKey: string
  negate?: boolean
}

export type Condition = AttributeCondition | SegmentCondition

/** One slice of a percentage rollout. Weights are percentages and must add up to 100. */
export interface RolloutVariation {
  variant: string
  weight: number
}

/** What a rule or the fallthrough serves: a fixed variant or a sticky percentage split. */
export type Serve =
  | { type: 'variant'; variant: string }
  | {
      type: 'rollout'
      variations: RolloutVariation[]
      /** Context attribute used for bucketing. Defaults to `targetingKey`. */
      bucketBy?: string
    }

/**
 * A targeting rule. All conditions must match (logical AND). A rule without
 * conditions matches every context. Rules are evaluated in order; the first
 * matching rule wins.
 */
export interface Rule {
  id: string
  description?: string
  conditions: Condition[]
  serve: Serve
}

/** A running experiment attached to a flag in one environment. */
export interface ExperimentAllocation {
  key: string
  variations: RolloutVariation[]
  bucketBy?: string
}

/** Per-environment behaviour of a flag. */
export interface FlagEnvironmentConfig {
  enabled: boolean
  /** Variant served while the flag is disabled. */
  offVariant: string
  rules: Rule[]
  /** Served when the flag is enabled and no rule matched. */
  fallthrough: Serve
  /**
   * When present, contexts that reach the fallthrough are allocated by the
   * experiment instead, so that exposure can be recorded per experiment.
   */
  experiment?: ExperimentAllocation
}

/**
 * A reusable, named group of contexts. Segment conditions may not reference other
 * segments. `match` controls whether all or any of the conditions must hold; it
 * defaults to `all`.
 */
export interface Segment {
  key: string
  conditions: AttributeCondition[]
  match?: 'all' | 'any'
}

/** The evaluation context as described by OpenFeature. Attribute values must be JSON. */
export interface EvaluationContext {
  targetingKey?: string
  [attribute: string]: JsonValue | undefined
}

/**
 * Why a value was returned. These mirror the OpenFeature / OFREP reasons:
 *
 * - `DISABLED`: the flag is off, the off variant was served.
 * - `TARGETING_MATCH`: a rule matched and served a fixed variant.
 * - `SPLIT`: a sticky percentage rollout (rule, fallthrough or experiment) chose the variant.
 * - `STATIC`: no rule matched and the fallthrough served a fixed variant.
 * - `ERROR`: evaluation failed, see `errorCode`.
 */
export type ResolutionReason = 'DISABLED' | 'TARGETING_MATCH' | 'SPLIT' | 'STATIC' | 'ERROR'

export type ErrorCode =
  | 'FLAG_NOT_FOUND'
  | 'TARGETING_KEY_MISSING'
  | 'TYPE_MISMATCH'
  | 'PARSE_ERROR'
  | 'INVALID_CONTEXT'
  | 'GENERAL'

/** The outcome of evaluating one flag for one context. */
export interface EvaluationDetails {
  flagKey: string
  /**
   * The resolved value. On `ERROR` this is the off variant's value when one is
   * known so callers that evaluate locally still get a safe fallback; it is
   * `null` otherwise.
   */
  value: JsonValue
  variant?: string
  reason: ResolutionReason
  errorCode?: ErrorCode
  errorMessage?: string
  /** Id of the rule that matched, if any. */
  ruleId?: string
  /** Zero based index of the rule that matched, if any. */
  ruleIndex?: number
  /** Segment keys that were part of the matching rule's conditions and matched. */
  matchedSegments?: string[]
  /** Bucket the context landed in for a `SPLIT`, as a percentage in [0, 100). */
  bucket?: number
  /** Set when the value came from an experiment allocation. */
  experimentKey?: string
}

/** Everything needed to evaluate a single flag. */
export interface EvaluationInput {
  flag: FlagDefinition
  config: FlagEnvironmentConfig
  /** Segments referenced by the rules, keyed by segment key. */
  segments?: Record<string, Segment>
  context: EvaluationContext
}

/** A self-contained snapshot of one environment, suitable for local evaluation. */
export interface Ruleset {
  version: 1
  projectKey: string
  environmentKey: string
  generatedAt: string
  flags: Record<string, { flag: FlagDefinition; config: FlagEnvironmentConfig }>
  segments: Record<string, Segment>
}
