import { describe, expect, it } from 'vitest'
import { BUCKET_COUNT, bucketFor, pickVariation } from '../src/bucket'
import { murmurhash3_32 } from '../src/hash'
import type { RolloutVariation } from '../src/types'

const split = (...weights: number[]): RolloutVariation[] =>
  weights.map((weight, i) => ({ variant: `v${i}`, weight }))

describe('bucketFor', () => {
  it('is murmurhash3_32(salt + "." + bucketValue) % 100000', () => {
    expect(BUCKET_COUNT).toBe(100_000)
    for (const key of ['a', 'user-1', 'ü-ñ', '']) {
      expect(bucketFor('flag', key)).toBe(murmurhash3_32(`flag.${key}`) % 100_000)
    }
  })

  it('matches reference buckets computed with the C reference implementation', () => {
    // Cross-language contract: other SDKs must reproduce these exact numbers.
    expect(bucketFor('my-flag', 'user-0')).toBe(85701)
    expect(bucketFor('my-flag', 'user-1')).toBe(79288)
    expect(bucketFor('my-flag', 'user-2')).toBe(53257)
    expect(bucketFor('my-flag', 'user-3')).toBe(73851)
    expect(bucketFor('my-flag', 'user-4')).toBe(85179)
    expect(bucketFor('new-checkout', 'user-42')).toBe(0x71d8599d % 100_000)
  })

  it('is deterministic', () => {
    for (let i = 0; i < 100; i++) {
      expect(bucketFor('flag', `user-${i}`)).toBe(bucketFor('flag', `user-${i}`))
    }
  })

  it('returns integers in [0, 100000)', () => {
    for (let i = 0; i < 10_000; i++) {
      const bucket = bucketFor('range', `user-${i}`)
      expect(Number.isInteger(bucket)).toBe(true)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(100_000)
    }
  })

  it('assigns the same key differently under different salts', () => {
    let different = 0
    for (let i = 0; i < 1000; i++) {
      if (bucketFor('flag-a', `user-${i}`) !== bucketFor('flag-b', `user-${i}`)) different++
    }
    // Independent hashes collide with probability 1e-5 per key.
    expect(different).toBeGreaterThan(990)

    // And the resulting 50/50 assignments are (roughly) independent between salts.
    let sameSide = 0
    for (let i = 0; i < 10_000; i++) {
      const a = bucketFor('flag-a', `user-${i}`) < 50_000
      const b = bucketFor('flag-b', `user-${i}`) < 50_000
      if (a === b) sameSide++
    }
    expect(sameSide / 10_000).toBeGreaterThan(0.47)
    expect(sameSide / 10_000).toBeLessThan(0.53)
  })
})

describe('bucket distribution', () => {
  const N = 100_000

  const distribution = (salt: string, variations: RolloutVariation[]) => {
    const counts = new Map<string, number>()
    for (let i = 0; i < N; i++) {
      const picked = pickVariation(variations, bucketFor(salt, `user-${i}`))
      expect(picked).toBeDefined()
      counts.set(picked!.variant, (counts.get(picked!.variant) ?? 0) + 1)
    }
    return variations.map((v) => ((counts.get(v.variant) ?? 0) / N) * 100)
  }

  it('splits 50/50 within ±1 percentage point', () => {
    const [a, b] = distribution('dist-50-50', split(50, 50))
    expect(Math.abs(a! - 50)).toBeLessThan(1)
    expect(Math.abs(b! - 50)).toBeLessThan(1)
  })

  it('splits 10/20/70 within ±1 percentage point', () => {
    const [a, b, c] = distribution('dist-10-20-70', split(10, 20, 70))
    expect(Math.abs(a! - 10)).toBeLessThan(1)
    expect(Math.abs(b! - 20)).toBeLessThan(1)
    expect(Math.abs(c! - 70)).toBeLessThan(1)
  })

  it('spreads buckets evenly across 10 deciles', () => {
    const deciles = new Array<number>(10).fill(0)
    for (let i = 0; i < N; i++) {
      const decile = Math.floor(bucketFor('deciles', `user-${i}`) / 10_000)
      deciles[decile] = (deciles[decile] ?? 0) + 1
    }
    for (const count of deciles) expect(Math.abs((count / N) * 100 - 10)).toBeLessThan(1)
  })
})

describe('pickVariation', () => {
  it('uses cumulative weights × 1000 as exclusive upper bounds', () => {
    const variations = split(50, 50)
    expect(pickVariation(variations, 0)?.variant).toBe('v0')
    expect(pickVariation(variations, 49_999)?.variant).toBe('v0')
    expect(pickVariation(variations, 50_000)?.variant).toBe('v1')
    expect(pickVariation(variations, 99_999)?.variant).toBe('v1')
  })

  it('handles three-way splits at their boundaries', () => {
    const variations = split(10, 20, 70)
    expect(pickVariation(variations, 9_999)?.variant).toBe('v0')
    expect(pickVariation(variations, 10_000)?.variant).toBe('v1')
    expect(pickVariation(variations, 29_999)?.variant).toBe('v1')
    expect(pickVariation(variations, 30_000)?.variant).toBe('v2')
    expect(pickVariation(variations, 99_999)?.variant).toBe('v2')
  })

  it('supports three decimal places of precision', () => {
    const variations = split(0.001, 99.999)
    expect(pickVariation(variations, 0)?.variant).toBe('v0')
    expect(pickVariation(variations, 1)?.variant).toBe('v1')
  })

  it('is robust against floating point accumulation errors', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754; thresholds are rounded to whole buckets.
    const variations = split(0.1, 0.2, 99.7)
    expect(pickVariation(variations, 99)?.variant).toBe('v0')
    expect(pickVariation(variations, 100)?.variant).toBe('v1')
    expect(pickVariation(variations, 299)?.variant).toBe('v1')
    expect(pickVariation(variations, 300)?.variant).toBe('v2')

    const thirds = split(33.333, 33.333, 33.334)
    expect(pickVariation(thirds, 33_332)?.variant).toBe('v0')
    expect(pickVariation(thirds, 33_333)?.variant).toBe('v1')
    expect(pickVariation(thirds, 66_665)?.variant).toBe('v1')
    expect(pickVariation(thirds, 66_666)?.variant).toBe('v2')
    expect(pickVariation(thirds, 99_999)?.variant).toBe('v2')

    // Weights that sum to 100 within 1e-6 still cover the last bucket.
    const sevenths = split(...new Array<number>(7).fill(100 / 7))
    expect(pickVariation(sevenths, 99_999)?.variant).toBe('v6')
  })

  it('never picks zero-weight variations', () => {
    const variations = split(0, 100, 0)
    expect(pickVariation(variations, 0)?.variant).toBe('v1')
    expect(pickVariation(variations, 99_999)?.variant).toBe('v1')
  })

  it('returns undefined for buckets not covered when weights sum to less than 100', () => {
    const variations = split(30, 30)
    expect(pickVariation(variations, 59_999)?.variant).toBe('v1')
    expect(pickVariation(variations, 60_000)).toBeUndefined()
    expect(pickVariation(variations, 99_999)).toBeUndefined()
  })

  it('returns undefined for an empty list', () => {
    expect(pickVariation([], 0)).toBeUndefined()
  })

  it('treats negative and non-finite weights as zero', () => {
    const variations = split(-50, Number.NaN, 100)
    expect(pickVariation(variations, 0)?.variant).toBe('v2')
    expect(pickVariation(variations, 99_999)?.variant).toBe('v2')
  })

  it('returns the variation object itself', () => {
    const variations = split(100)
    expect(pickVariation(variations, 42)).toBe(variations[0])
  })
})
