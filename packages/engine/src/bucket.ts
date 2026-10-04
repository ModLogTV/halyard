import { murmurhash3_32 } from './hash'
import type { RolloutVariation } from './types'

/** Number of buckets. 100 000 buckets give three decimal places of percent precision. */
export const BUCKET_COUNT = 100_000

/** Buckets per percentage point of rollout weight. */
const BUCKETS_PER_PERCENT = BUCKET_COUNT / 100

/**
 * Deterministically maps a bucketing value to a bucket in `[0, 100000)`.
 *
 * Formula (part of the public contract, other implementations must reproduce it):
 *
 * ```
 * bucket = murmurhash3_x86_32(utf8(`${salt}.${bucketValue}`), seed = 0) % 100000
 * ```
 *
 * where the hash result is interpreted as an unsigned 32-bit integer. The engine
 * uses `salt = flagKey` for rule and fallthrough rollouts and
 * `salt = `${flagKey}.${experimentKey}`` for experiments.
 */
export function bucketFor(salt: string, bucketValue: string): number {
  return murmurhash3_32(`${salt}.${bucketValue}`) % BUCKET_COUNT
}

/**
 * Picks the rollout variation a bucket falls into.
 *
 * Weights are percentages. Variation `i` owns the half-open bucket range
 * `[round(1000 * sum(w[0..i-1])), round(1000 * sum(w[0..i])))`, i.e. cumulative
 * weights multiplied by 1000 (rounded to whole buckets to absorb floating point
 * error) are exclusive upper bounds. Negative or non-finite weights count as 0.
 *
 * Returns `undefined` when the bucket is not covered, which happens when the
 * weights add up to less than 100. Callers must treat that as a configuration error.
 */
export function pickVariation(
  variations: RolloutVariation[],
  bucket: number,
): RolloutVariation | undefined {
  let cumulativePercent = 0
  for (const variation of variations) {
    const weight = variation.weight
    if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
      cumulativePercent += weight
    }
    if (bucket < Math.round(cumulativePercent * BUCKETS_PER_PERCENT)) return variation
  }
  return undefined
}
