# @halyard/engine

The feature flag evaluation engine of [Halyard](../../README.md), the self-hosted feature flag platform.

Give it a flag definition, its environment configuration and an evaluation context, and it returns
a value together with the reason it was chosen. The same engine runs in the Halyard server, in the
UI playground and in any client that downloads a ruleset and evaluates flags locally.

- **Zero runtime dependencies.** Pure TypeScript, no Node-only APIs: runs in browsers, Bun, Node,
  Deno and edge runtimes.
- **Deterministic.** Percentage rollouts use MurmurHash3 with a documented formula, so any other
  implementation can reproduce the exact same buckets.
- **Never throws.** Any problem is reported as `reason: 'ERROR'` with an `errorCode`.

## Install

```sh
bun add @halyard/engine
# or: npm install @halyard/engine
```

## Usage

```ts
import { createEvaluator, evaluateFlag, type Ruleset } from '@halyard/engine'

// 1. Evaluate a single flag.
const details = evaluateFlag({
  flag: {
    key: 'new-checkout',
    type: 'boolean',
    variants: [
      { key: 'on', value: true },
      { key: 'off', value: false },
    ],
  },
  config: {
    enabled: true,
    offVariant: 'off',
    rules: [
      {
        id: 'internal-users',
        conditions: [{ type: 'attribute', attribute: 'email', operator: 'ends_with', value: '@acme.io' }],
        serve: { type: 'variant', variant: 'on' },
      },
    ],
    // Everyone else: sticky 20 % rollout.
    fallthrough: {
      type: 'rollout',
      variations: [
        { variant: 'on', weight: 20 },
        { variant: 'off', weight: 80 },
      ],
    },
  },
  context: { targetingKey: 'user-42', email: 'ada@example.com' },
})
// → { flagKey: 'new-checkout', value: true, variant: 'on', reason: 'SPLIT', bucket: 4.125 }

// 2. Evaluate against a ruleset snapshot (what the server exports for local evaluation).
declare const ruleset: Ruleset // e.g. await (await fetch('/api/rulesets/shop/production')).json()
const evaluator = createEvaluator(ruleset)

const color = evaluator.evaluate('button-color', { targetingKey: 'user-42', plan: 'pro' })
if (color.reason === 'ERROR') {
  console.warn(color.errorCode, color.errorMessage) // e.g. FLAG_NOT_FOUND
}
const all = evaluator.evaluateAll({ targetingKey: 'user-42' }) // Record<flagKey, EvaluationDetails>
```

Validation helpers reject bad configurations before they are saved. Each returns a list of human
readable problems; an empty list means valid:

```ts
import { validateEnvironmentConfig, validateFlagDefinition, validateSegment } from '@halyard/engine'

validateFlagDefinition(flag) // ['Variant "on": value must be a boolean (true or false) for a boolean flag']
validateEnvironmentConfig(flag, config, ['beta-testers']) // segment keys that exist
validateSegment(segment)
```

## Data model

All types are plain JSON and exported from the package (`src/types.ts`).

| Type | Purpose |
| --- | --- |
| `FlagDefinition` | Project-wide: `key`, `type` (`boolean` \| `string` \| `number` \| `json`) and `variants` (`{ key, value }`). |
| `FlagEnvironmentConfig` | Per environment: `enabled`, `offVariant`, ordered `rules`, `fallthrough`, optional `experiment`. |
| `Rule` | `id`, `conditions` (all must match; none = everyone) and `serve`. |
| `Serve` | `{ type: 'variant', variant }` or `{ type: 'rollout', variations: [{ variant, weight }], bucketBy? }`. Weights are percentages adding up to 100. |
| `Condition` | `{ type: 'attribute', attribute, operator, value }` or `{ type: 'segment', segmentKey, negate? }`. |
| `Segment` | Reusable list of attribute conditions with `match: 'all' \| 'any'` (default `all`). |
| `EvaluationContext` | OpenFeature context: `targetingKey` plus arbitrary JSON attributes. |
| `Ruleset` | Snapshot of one environment: all flags with their config plus all segments. |

Attributes are addressed by name (`plan`, `targetingKey`) or by dot path into nested objects
(`address.country`); a literal top-level key containing dots wins over the path. A missing (or
`null`) attribute only satisfies `not_exists`, `neq`, `not_in` and `not_contains`. Operators:
`eq`, `neq`, `in`, `not_in`, `contains`, `not_contains`, `starts_with`, `ends_with`, `gt`, `gte`,
`lt`, `lte`, `regex`, `exists`, `not_exists`, `semver_eq`, `semver_gt`, `semver_gte`, `semver_lt`,
`semver_lte`. See the doc comment of `matchAttributeCondition` for the exact coercion rules.

## Evaluation order and reasons

1. The flag and config are checked (variants exist, off variant and all referenced variants exist,
   known type). Problems → `ERROR` / `GENERAL`.
2. `enabled: false` → the off variant with reason **`DISABLED`**.
3. Rules in order, the first match wins: a variant → **`TARGETING_MATCH`**, a rollout → **`SPLIT`**.
   `ruleId`, `ruleIndex` and `matchedSegments` are set.
4. No rule matched and an `experiment` is configured → experiment allocation, **`SPLIT`** with
   `experimentKey`.
5. Otherwise the fallthrough: a variant → **`STATIC`**, a rollout → **`SPLIT`**.

Every `SPLIT` carries `bucket`, the context's bucket as a percentage in `[0, 100)` with three
decimals.

**`ERROR`** comes with an `errorCode`:

| `errorCode` | When |
| --- | --- |
| `FLAG_NOT_FOUND` | `createEvaluator().evaluate()` was asked for a flag that is not in the ruleset. |
| `TARGETING_KEY_MISSING` | A rollout needs `context[bucketBy ?? 'targetingKey']` and it is missing, empty, or not a string/number/boolean. |
| `TYPE_MISMATCH` | The served variant's value does not match the flag type. |
| `GENERAL` | Invalid configuration (e.g. unknown variant, weights that do not cover the bucket) or an unexpected error. |

On `ERROR`, `value` is the off variant's value when it exists and matches the flag type, so local
evaluation always has a safe fallback; otherwise it is `null`. `reasonToOfrep()` maps reasons to
OFREP (`ERROR` → `UNKNOWN`).

## Bucketing formula

Percentage rollouts are sticky: the same bucketing value always lands in the same bucket.
To reproduce Halyard's assignments in another language:

```
bucketValue = String(context[bucketBy ?? "targetingKey"])
salt        = flagKey                         // rule and fallthrough rollouts
salt        = flagKey + "." + experimentKey   // experiment allocations
bucket      = murmurhash3_x86_32(utf8(salt + "." + bucketValue), seed 0) mod 100000
```

- The hash is Austin Appleby's MurmurHash3 x86 32-bit over the UTF-8 bytes, read as an unsigned
  32-bit integer. Example: `bucketFor('my-flag', 'user-0') === 85701`.
- `bucket` is an integer in `[0, 100000)`, i.e. 0.001 % precision; `EvaluationDetails.bucket` is
  `bucket / 1000`.
- Variation `i` owns buckets `[round(1000 × Σ w[0..i-1]), round(1000 × Σ w[0..i]))`, where `w` are
  the weights in order. The context gets the first variation whose upper bound is greater than its
  bucket. Weights below 0 count as 0; if the weights add up to less than 100 the uncovered buckets
  produce an `ERROR`.
- Because rule and fallthrough rollouts share the salt, a context lands in the same bucket for
  every rollout of a flag, and raising a rollout from 10 % to 20 % only adds contexts.
- Numeric and boolean bucketing values are stringified with JavaScript semantics (`42` → `"42"`).
  Prefer string attributes for cross-language consistency.

`murmurhash3_32`, `bucketFor` and `pickVariation` are exported for other tooling.

## Development

```sh
bun run test       # vitest
bun run typecheck  # strict tsc
bun run build      # emits dist/
```

## License

MIT
