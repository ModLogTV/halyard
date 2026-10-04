/**
 * Statistics for A/B experiments. Pure functions, no database access.
 *
 * Every treatment variant is compared with the control variant using a two-sided
 * two-proportion z-test with a pooled standard error. Conversion rates carry a 95 %
 * Wilson score interval. See `docs/experiments.md` for the method and its limits.
 */

/** Two-sided significance level. */
export const SIGNIFICANCE_LEVEL = 0.05
/** Minimum exposures in both the variant and the control before a result can be significant. */
export const MIN_EXPOSURES_PER_VARIANT = 100
/** Minimum conversions in both the variant and the control before a result can be significant. */
export const MIN_CONVERSIONS_PER_VARIANT = 5
/** Φ⁻¹(0.975): the z value of a two-sided 95 % interval. */
export const Z_95 = 1.959963984540054

export type Verdict = 'insufficient-data' | 'no-difference' | 'winner' | 'loser'

export interface Interval {
  lower: number
  upper: number
}

export interface VariantCounts {
  variant: string
  exposures: number
  conversions: number
}

export interface VariantResult extends VariantCounts {
  isControl: boolean
  /** conversions / exposures; 0 without exposures. */
  conversionRate: number
  /** 95 % Wilson score interval of the conversion rate; null without exposures. */
  confidenceInterval: Interval | null
  /** At least {@link MIN_EXPOSURES_PER_VARIANT} exposures and {@link MIN_CONVERSIONS_PER_VARIANT} conversions. */
  minimumSampleReached: boolean
  /** rate − control rate. Null for the control and when either group has no exposures. */
  lift: number | null
  /** (rate − control rate) / control rate. Null for the control and when the control rate is 0. */
  relativeLift: number | null
  /** z statistic of the two-proportion test against the control. Null for the control. */
  zScore: number | null
  /** Two-sided p-value of the test against the control. Null for the control. */
  pValue: number | null
  /** p < {@link SIGNIFICANCE_LEVEL} and both groups reached the minimum sample. */
  significant: boolean
  /** Outcome relative to the control; null for the control itself. */
  verdict: Verdict | null
}

export interface ExperimentResults {
  /** The control first, then the other variants in allocation order. */
  variants: VariantResult[]
  control: string
  totalExposures: number
  totalConversions: number
  startedAt: Date | null
  stoppedAt: Date | null
}

/** ln(√(2π)) */
const LN_SQRT_2PI = 0.9189385332046728
/** Beyond this |x| the tail is computed with a continued fraction (relative precision). */
const TAIL_THRESHOLD = 3
const MAX_ITERATIONS = 5_000
const TINY = 1e-300

/**
 * Upper tail Q(x) = 1 − Φ(x) for x > 0 via the continued fraction of the Mills ratio
 * Q(x) = φ(x) / (x + 1/(x + 2/(x + 3/(x + …)))), evaluated with the modified Lentz
 * algorithm. Converges quickly for x ≥ 3 and keeps full relative precision far into
 * the tail.
 */
function upperTail(x: number): number {
  let f = x
  let c = x
  let d = 0
  for (let k = 1; k <= MAX_ITERATIONS; k += 1) {
    d = x + k * d
    if (d === 0) d = TINY
    c = x + k / c
    if (c === 0) c = TINY
    d = 1 / d
    const delta = c * d
    f *= delta
    if (Math.abs(delta - 1) < 1e-16) break
  }
  return Math.exp(-0.5 * x * x - LN_SQRT_2PI) / f
}

/**
 * Standard normal CDF Φ(x).
 *
 * |x| ≤ 3: Marsaglia's Taylor series (G. Marsaglia, "Evaluating the Normal
 * Distribution", J. Stat. Softw. 11(4), 2004), Φ(x) = ½ + φ(x)·(x + x³/3 + x⁵/(3·5) + …),
 * summed until the terms no longer change the result (absolute error ~1e-16).
 * |x| > 3: the continued fraction in {@link upperTail}, so small tail
 * probabilities (p-values) keep their relative precision.
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN
  if (x === Number.POSITIVE_INFINITY) return 1
  if (x === Number.NEGATIVE_INFINITY) return 0
  if (x > TAIL_THRESHOLD) return 1 - upperTail(x)
  if (x < -TAIL_THRESHOLD) return upperTail(-x)
  const q = x * x
  let sum = x
  let term = x
  for (let i = 3; i < MAX_ITERATIONS; i += 2) {
    term *= q / i
    const next = sum + term
    if (next === sum) break
    sum = next
  }
  return 0.5 + sum * Math.exp(-0.5 * q - LN_SQRT_2PI)
}

/** Wilson score interval for `successes` out of `trials`; null when there are no trials. */
export function wilsonInterval(successes: number, trials: number, z = Z_95): Interval | null {
  if (trials <= 0) return null
  const p = successes / trials
  const z2 = z * z
  const denominator = 1 + z2 / trials
  const center = (p + z2 / (2 * trials)) / denominator
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) }
}

export interface ZTestResult {
  z: number
  pValue: number
}

/**
 * Two-sided two-proportion z-test of group 1 against group 2 with a pooled standard
 * error: z = (p1 − p2) / √(p(1 − p)(1/n1 + 1/n2)), p = (c1 + c2) / (n1 + n2).
 * Null when either group has no trials. When the pooled rate is 0 or 1 both rates are
 * equal, so z = 0 and p = 1.
 */
export function twoProportionZTest(
  conversions1: number,
  trials1: number,
  conversions2: number,
  trials2: number,
): ZTestResult | null {
  if (trials1 <= 0 || trials2 <= 0) return null
  const p1 = conversions1 / trials1
  const p2 = conversions2 / trials2
  const pooled = (conversions1 + conversions2) / (trials1 + trials2)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trials1 + 1 / trials2))
  if (se === 0 || !Number.isFinite(se)) return { z: 0, pValue: 1 }
  const z = (p1 - p2) / se
  const pValue = Math.min(1, 2 * normalCdf(-Math.abs(z)))
  return { z, pValue }
}

export const conversionRate = (conversions: number, exposures: number): number =>
  exposures > 0 ? conversions / exposures : 0

export const minimumSampleReached = (counts: Pick<VariantCounts, 'exposures' | 'conversions'>) =>
  counts.exposures >= MIN_EXPOSURES_PER_VARIANT && counts.conversions >= MIN_CONVERSIONS_PER_VARIANT

/** Compares one treatment variant with the control. */
export function compareWithControl(
  variant: VariantCounts,
  control: VariantCounts,
): Pick<VariantResult, 'lift' | 'relativeLift' | 'zScore' | 'pValue' | 'significant' | 'verdict'> {
  const rate = conversionRate(variant.conversions, variant.exposures)
  const controlRate = conversionRate(control.conversions, control.exposures)
  const hasData = variant.exposures > 0 && control.exposures > 0
  const lift = hasData ? rate - controlRate : null
  const relativeLift = hasData && controlRate > 0 ? (rate - controlRate) / controlRate : null
  const test = twoProportionZTest(
    variant.conversions,
    variant.exposures,
    control.conversions,
    control.exposures,
  )
  const enoughData = minimumSampleReached(variant) && minimumSampleReached(control)
  const significant = enoughData && test !== null && test.pValue < SIGNIFICANCE_LEVEL
  let verdict: Verdict
  if (!enoughData || test === null) verdict = 'insufficient-data'
  else if (!significant) verdict = 'no-difference'
  else verdict = rate > controlRate ? 'winner' : 'loser'
  return {
    lift,
    relativeLift,
    zScore: test?.z ?? null,
    pValue: test?.pValue ?? null,
    significant,
    verdict,
  }
}

/**
 * Builds the results of an experiment from per-variant counts. Counts must not
 * repeat a variant. A control without counts is treated as having no exposures.
 */
export function computeResults(input: {
  control: string
  counts: VariantCounts[]
  startedAt?: Date | null
  stoppedAt?: Date | null
}): ExperimentResults {
  const control = input.counts.find((c) => c.variant === input.control) ?? {
    variant: input.control,
    exposures: 0,
    conversions: 0,
  }
  const others = input.counts.filter((c) => c.variant !== input.control)

  const base = (counts: VariantCounts) => ({
    variant: counts.variant,
    exposures: counts.exposures,
    conversions: counts.conversions,
    conversionRate: conversionRate(counts.conversions, counts.exposures),
    confidenceInterval: wilsonInterval(counts.conversions, counts.exposures),
    minimumSampleReached: minimumSampleReached(counts),
  })

  const variants: VariantResult[] = [
    {
      ...base(control),
      isControl: true,
      lift: null,
      relativeLift: null,
      zScore: null,
      pValue: null,
      significant: false,
      verdict: null,
    },
    ...others.map((counts) => ({
      ...base(counts),
      isControl: false,
      ...compareWithControl(counts, control),
    })),
  ]

  return {
    variants,
    control: input.control,
    totalExposures: variants.reduce((sum, v) => sum + v.exposures, 0),
    totalConversions: variants.reduce((sum, v) => sum + v.conversions, 0),
    startedAt: input.startedAt ?? null,
    stoppedAt: input.stoppedAt ?? null,
  }
}
