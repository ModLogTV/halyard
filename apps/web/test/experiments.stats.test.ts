import { describe, expect, it } from 'vitest'
import {
  compareWithControl,
  computeResults,
  conversionRate,
  MIN_CONVERSIONS_PER_VARIANT,
  MIN_EXPOSURES_PER_VARIANT,
  minimumSampleReached,
  normalCdf,
  SIGNIFICANCE_LEVEL,
  twoProportionZTest,
  wilsonInterval,
} from '@/server/experiments/stats'

describe('normalCdf', () => {
  it.each([
    [0, 0.5],
    [1, 0.8413447460685429],
    [-1, 0.15865525393145705],
    [1.96, 0.9750021048517795],
    [-1.96, 0.02499789514822043],
    [2.5, 0.9937903346742238],
    [3, 0.9986501019683699],
    [-3, 0.0013498980316300957],
    [4.5, 0.9999966023268753],
    [-6, 9.865876450377014e-10],
    [6, 0.9999999990134123],
  ])('Φ(%d) = %d', (x, expected) => {
    expect(Math.abs(normalCdf(x) - expected)).toBeLessThan(1e-12)
  })

  it('keeps relative precision far in the lower tail', () => {
    // Φ(-8) = 6.22096057427182e-16 (reference: 0.5 * erfc(8 / √2)).
    expect(normalCdf(-8) / 6.22096057427182e-16).toBeCloseTo(1, 10)
  })

  it('is monotone and symmetric on [-6, 6]', () => {
    let previous = 0
    for (let x = -6; x <= 6; x += 0.01) {
      const value = normalCdf(x)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(Math.abs(value + normalCdf(-x) - 1)).toBeLessThan(1e-15)
      previous = value
    }
  })

  it('handles infinities and NaN', () => {
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1)
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(normalCdf(Number.NaN)).toBeNaN()
  })
})

describe('wilsonInterval', () => {
  it('matches the textbook example 7/20', () => {
    const interval = wilsonInterval(7, 20)
    expect(interval?.lower).toBeCloseTo(0.1812, 4)
    expect(interval?.upper).toBeCloseTo(0.5671, 4)
  })

  it('stays within [0, 1] at the extremes', () => {
    const none = wilsonInterval(0, 50)
    expect(none?.lower).toBeCloseTo(0, 12)
    expect(none?.upper).toBeCloseTo(0.07135, 5)
    const all = wilsonInterval(50, 50)
    expect(all?.upper).toBe(1)
    expect(all?.lower).toBeCloseTo(0.92865, 5)
  })

  it('is null without trials', () => {
    expect(wilsonInterval(0, 0)).toBeNull()
  })
})

describe('twoProportionZTest', () => {
  it('matches a worked example (200/1000 vs 250/1000, pooled SE)', () => {
    // p = 0.225, SE = √(0.225 · 0.775 · 0.002) = 0.0186749, z = -0.05 / SE.
    const result = twoProportionZTest(200, 1000, 250, 1000)
    expect(result?.z).toBeCloseTo(-2.6774, 4)
    expect(result?.pValue).toBeCloseTo(0.00742, 6)
  })

  it('is antisymmetric in the groups', () => {
    const ab = twoProportionZTest(30, 400, 50, 420)
    const ba = twoProportionZTest(50, 420, 30, 400)
    expect(ab?.z).toBeCloseTo(-(ba?.z ?? 0), 12)
    expect(ab?.pValue).toBeCloseTo(ba?.pValue ?? 0, 12)
  })

  it('returns z = 0 and p = 1 for identical rates', () => {
    expect(twoProportionZTest(10, 100, 20, 200)).toEqual({ z: 0, pValue: 1 })
  })

  it('handles a pooled rate of 0 or 1 without dividing by zero', () => {
    expect(twoProportionZTest(0, 100, 0, 100)).toEqual({ z: 0, pValue: 1 })
    expect(twoProportionZTest(100, 100, 50, 50)).toEqual({ z: 0, pValue: 1 })
  })

  it('is null when a group has no trials', () => {
    expect(twoProportionZTest(0, 0, 5, 100)).toBeNull()
    expect(twoProportionZTest(5, 100, 0, 0)).toBeNull()
  })
})

describe('guards', () => {
  it('exposes the minimum-sample rule as constants', () => {
    expect(SIGNIFICANCE_LEVEL).toBe(0.05)
    expect(MIN_EXPOSURES_PER_VARIANT).toBe(100)
    expect(MIN_CONVERSIONS_PER_VARIANT).toBe(5)
  })

  it('requires both minimum exposures and minimum conversions', () => {
    expect(minimumSampleReached({ exposures: 100, conversions: 5 })).toBe(true)
    expect(minimumSampleReached({ exposures: 99, conversions: 50 })).toBe(false)
    expect(minimumSampleReached({ exposures: 10_000, conversions: 4 })).toBe(false)
  })

  it('conversionRate is 0 without exposures', () => {
    expect(conversionRate(0, 0)).toBe(0)
    expect(conversionRate(3, 12)).toBe(0.25)
  })
})

describe('compareWithControl', () => {
  const control = { variant: 'control', exposures: 1000, conversions: 200 }

  it('declares a winner when the variant converts significantly better', () => {
    const result = compareWithControl({ variant: 'b', exposures: 1000, conversions: 250 }, control)
    expect(result.lift).toBeCloseTo(0.05, 12)
    expect(result.relativeLift).toBeCloseTo(0.25, 12)
    expect(result.zScore).toBeCloseTo(2.6774, 4)
    expect(result.significant).toBe(true)
    expect(result.verdict).toBe('winner')
  })

  it('declares a loser when the variant converts significantly worse', () => {
    const result = compareWithControl({ variant: 'b', exposures: 1000, conversions: 150 }, control)
    expect(result.lift).toBeCloseTo(-0.05, 12)
    expect(result.significant).toBe(true)
    expect(result.verdict).toBe('loser')
  })

  it('reports no difference when p >= 0.05', () => {
    const result = compareWithControl({ variant: 'b', exposures: 1000, conversions: 210 }, control)
    expect(result.pValue).toBeGreaterThan(SIGNIFICANCE_LEVEL)
    expect(result.significant).toBe(false)
    expect(result.verdict).toBe('no-difference')
  })

  it('does not declare a winner on a tiny sample even when p < 0.05', () => {
    const small = { variant: 'control', exposures: 60, conversions: 1 }
    const result = compareWithControl({ variant: 'b', exposures: 60, conversions: 15 }, small)
    expect(result.pValue).toBeLessThan(SIGNIFICANCE_LEVEL)
    expect(result.significant).toBe(false)
    expect(result.verdict).toBe('insufficient-data')
  })

  it('requires the control to reach the minimum sample too', () => {
    const lowControl = { variant: 'control', exposures: 1000, conversions: 4 }
    const result = compareWithControl(
      { variant: 'b', exposures: 1000, conversions: 100 },
      lowControl,
    )
    expect(result.verdict).toBe('insufficient-data')
    expect(result.significant).toBe(false)
  })

  it('leaves relative lift null when the control rate is 0', () => {
    const zero = { variant: 'control', exposures: 500, conversions: 0 }
    const result = compareWithControl({ variant: 'b', exposures: 500, conversions: 10 }, zero)
    expect(result.lift).toBeCloseTo(0.02, 12)
    expect(result.relativeLift).toBeNull()
  })

  it('handles groups without exposures', () => {
    const empty = { variant: 'control', exposures: 0, conversions: 0 }
    const result = compareWithControl({ variant: 'b', exposures: 0, conversions: 0 }, empty)
    expect(result).toEqual({
      lift: null,
      relativeLift: null,
      zScore: null,
      pValue: null,
      significant: false,
      verdict: 'insufficient-data',
    })
  })
})

describe('computeResults', () => {
  it('puts the control first and compares every other variant with it', () => {
    const startedAt = new Date('2026-01-01T00:00:00Z')
    const results = computeResults({
      control: 'a',
      counts: [
        { variant: 'b', exposures: 1000, conversions: 250 },
        { variant: 'a', exposures: 1000, conversions: 200 },
        { variant: 'c', exposures: 0, conversions: 0 },
      ],
      startedAt,
    })
    expect(results.control).toBe('a')
    expect(results.totalExposures).toBe(2000)
    expect(results.totalConversions).toBe(450)
    expect(results.startedAt).toBe(startedAt)
    expect(results.stoppedAt).toBeNull()
    expect(results.variants.map((v) => v.variant)).toEqual(['a', 'b', 'c'])

    const [a, b, c] = results.variants
    expect(a).toMatchObject({
      isControl: true,
      conversionRate: 0.2,
      minimumSampleReached: true,
      lift: null,
      pValue: null,
      significant: false,
      verdict: null,
    })
    expect(a?.confidenceInterval).toEqual(wilsonInterval(200, 1000))
    expect(b).toMatchObject({ isControl: false, conversionRate: 0.25, verdict: 'winner' })
    expect(b?.pValue).toBeCloseTo(0.00742, 5)
    expect(c).toMatchObject({
      conversionRate: 0,
      confidenceInterval: null,
      minimumSampleReached: false,
      verdict: 'insufficient-data',
    })
  })

  it('adds an empty control when there is no data for it', () => {
    const results = computeResults({ control: 'a', counts: [] })
    expect(results.variants).toHaveLength(1)
    expect(results.variants[0]).toMatchObject({ variant: 'a', exposures: 0, conversions: 0 })
  })
})
