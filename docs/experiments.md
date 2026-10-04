# Experiments

An experiment splits the subjects (targeting keys) that reach a flag's default in one environment across weighted variants. It records which variant each subject saw (an **exposure**) and whether the subject later sent a **conversion event**. Halyard then compares each variant's conversion rate with a **control** variant.

## Lifecycle

| Status | Meaning |
| --- | --- |
| `draft` | Being set up. Every field can be edited. Not part of the ruleset. |
| `running` | Allocating subjects and counting conversions. Only name and hypothesis can be edited. |
| `stopped` | Finished. Results are frozen; evaluation falls back to the flag's own configuration. |

- **Create** (`experiment:create`) always creates a draft. Several drafts may exist for the same flag and environment.
- **Start** (`experiment:update`) moves a draft to `running` and sets `startedAt`. Only **one running experiment per flag and environment** is allowed; starting a second one fails with `409`. A stopped experiment cannot be restarted, because its results would mix two periods. Create a new experiment instead.
- **Stop** (`experiment:update`) moves a running experiment to `stopped` and sets `stoppedAt`.
- **Delete** (`experiment:delete`) is not allowed while the experiment is running. Deleting removes its exposures and conversions.

Starting and stopping invalidate the environment's ruleset cache on every replica, so evaluations pick up the change immediately. Every change is written to the audit log (`experiment.created`, `.updated`, `.started`, `.stopped`, `.deleted`).

### Validation

- `key` follows the usual key rules (letters, digits, `.`, `_`, `-`) and is unique within the project.
- `allocation` lists at least two variants of the flag, without duplicates, and the weights add up to 100.
- `controlVariant` is part of the allocation and has a weight above 0.
- `conversionEvent` is a non-empty event name (up to 200 characters).
- Allocation, control variant and conversion event can only be changed while the experiment is a draft. Changing them after exposures were recorded would mix subjects allocated under different splits, or count a different event, and the results would no longer be comparable. When an experiment starts, its allocation is checked again against the flag's current variants.

## Allocation and exposures

A running experiment applies to contexts that **match no targeting rule** of an enabled flag. Rules still win, and a disabled flag still serves its off variant. The variant is chosen by a sticky hash of `targetingKey`, salted with `<flagKey>.<experimentKey>`, so a subject sees the same variant for the whole experiment.

Every evaluation that is allocated by the experiment (OFREP single and bulk evaluation) and carries a `targetingKey` records an exposure. Exposures are stored once per subject (the first allocation wins) as the hex SHA-256 of the targeting key; the raw key is never stored. They are buffered in memory and written to Postgres every 5 seconds.

Local evaluation with a downloaded ruleset (`/api/v1/ruleset` + `@halyard/engine`) does not record exposures.

## Tracking conversions

`POST /api/v1/track` records conversion events. It authenticates with an **SDK key** of the environment the experiment runs in (`Authorization: Bearer hal_sdk_…` or `X-API-Key`). It sends CORS headers (`Access-Control-Allow-Origin: *`, `OPTIONS` preflight), so browsers can call it directly.

The body is one event or an array of up to 100 events:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `event` | string | yes | Event name, matched against each running experiment's `conversionEvent` |
| `targetingKey` | string | yes | The same targeting key that was used for evaluation |
| `value` | number | no | Accepted and validated but **not stored yet**, reserved for future revenue/value metrics |
| `timestamp` | string | no | ISO 8601 time of the conversion (with `Z` or an offset). Defaults to the time of receipt; future times are clamped to now |

Responses:

| Status | Body |
| --- | --- |
| `202` | `{ "accepted": <events in the request>, "matched": <(event, experiment) pairs attributed to an exposure> }` |
| `400` | `{ "error": "BAD_REQUEST", "message": "…" }` for invalid JSON, missing fields or more than 100 events |
| `401` | `{ "error": "UNAUTHORIZED", "message": "…" }` for a missing or invalid SDK key |

```sh
curl -X POST https://halyard.example.com/api/v1/track \
  -H "Authorization: Bearer $HALYARD_SDK_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "event": "purchase", "targetingKey": "user-123" }'
# {"accepted":1,"matched":1}
```

```js
await fetch('https://halyard.example.com/api/v1/track', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${sdkKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify([
    { event: 'purchase', targetingKey: user.id, value: 49.9 },
    { event: 'signup', targetingKey: user.id, timestamp: new Date().toISOString() },
  ]),
})
```

`navigator.sendBeacon` cannot set the `Authorization` header, so use `fetch` (with `keepalive: true` when sending on page unload).

### Attribution rules

A conversion event is attributed to every experiment that:

1. is **running** in the SDK key's environment,
2. has `conversionEvent` equal to `event`, and
3. has an exposure for the subject.

The conversion is stored with the variant the subject was exposed to. **Only the first conversion per subject and experiment counts**; repeats are accepted (and reported in `matched`) but do not change the results. Events from subjects that were never exposed are ignored. The metric is therefore a per-subject conversion rate, not an event count.

Exposures reach Postgres up to 5 seconds after the evaluation, so a conversion sent right after the evaluation can arrive before its exposure. Such conversions (`matched` does not include them) are kept in memory for up to **60 seconds** and checked again every 5 seconds and on the next tracking request. If the exposure shows up in that window, the conversion is recorded with its original timestamp. Otherwise it is dropped. This pending list is bounded (10 000 entries per replica) and is lost when the process restarts.

## Statistics

Results are computed on read from the exposure and conversion counts per variant (`src/server/experiments/stats.ts`).

**Per variant**

- `exposures`, `conversions`
- `conversionRate` = conversions / exposures (0 without exposures)
- `confidenceInterval`: the 95 % [Wilson score interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval) of the rate, `null` without exposures. With p̂ = c/n and z = 1.959964:

  ```
  center = (p̂ + z²/2n) / (1 + z²/n)
  half   = z · √(p̂(1 − p̂)/n + z²/4n²) / (1 + z²/n)
  ```

  Unlike the normal (Wald) interval it behaves well for small samples and rates near 0 or 1. Example: 7/20 → [0.1812, 0.5671].

**Each variant compared with the control**

- `lift` = rate − controlRate (absolute, in rate units)
- `relativeLift` = (rate − controlRate) / controlRate, `null` when the control rate is 0
- `zScore` and `pValue`: a two-sided **two-proportion z-test with pooled standard error**

  ```
  p  = (c₁ + c₂) / (n₁ + n₂)
  z  = (p₁ − p₂) / √(p(1 − p)(1/n₁ + 1/n₂))
  pValue = 2 · Φ(−|z|)
  ```

  where group 1 is the variant and group 2 the control. When the pooled rate is 0 or 1 the rates are equal and z = 0, p = 1. Example: 250/1000 vs a control of 200/1000 → z = 2.677, p = 0.0074.
- Φ, the standard normal CDF, uses Marsaglia's Taylor series (2004) for |x| ≤ 3 and the continued fraction of the Mills ratio (modified Lentz) beyond that. The absolute error is below 1e-15 on [−8, 8], and small tail probabilities keep their relative precision.

**Minimum-sample rule and verdict**

A result is `significant` only when **pValue < 0.05 and both the variant and the control have at least 100 exposures and at least 5 conversions**. The guards keep the test from declaring a winner on a handful of subjects, where the normal approximation behind the z-test is unreliable. They are the constants `SIGNIFICANCE_LEVEL`, `MIN_EXPOSURES_PER_VARIANT` and `MIN_CONVERSIONS_PER_VARIANT`. Each variant also reports `minimumSampleReached`.

| `verdict` | When |
| --- | --- |
| `insufficient-data` | The variant or the control has not reached the minimum sample |
| `no-difference` | Minimum sample reached, p ≥ 0.05 |
| `winner` | Significant and the variant converts better than the control |
| `loser` | Significant and the variant converts worse than the control |

The control itself has `verdict: null` and no comparison fields.

### Limits

- **Higher is better.** A `winner` has a higher conversion rate than the control. For "lower is better" metrics, read `loser` as the improvement.
- **No correction for multiple comparisons.** With several treatment variants, each one is tested against the control at α = 0.05, so the chance of at least one false positive grows with the number of variants.
- **Peeking.** The test assumes a sample size fixed in advance. Looking at results repeatedly and stopping as soon as p < 0.05 inflates the false positive rate. Decide on a sample size (or duration) before starting and judge the result then.
- **Conversions are counted per subject**, once, no matter how many events a subject sends. `value` is not used yet.
