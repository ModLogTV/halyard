import type { FlagType, RolloutVariation, Variant } from '@halyard/engine'
import { WEIGHT_TOLERANCE } from '@halyard/engine'
import { sumWeights } from '@/components/flags'

export type ExperimentStatus = 'draft' | 'running' | 'stopped'

export interface EnvironmentOption {
  id?: string
  key: string
  name: string
  color: string
  isProduction: boolean
}

/** The slice of a flag the experiment form needs. */
export interface FlagOption {
  key: string
  name: string
  type: FlagType
  variants: Variant[]
}

export function keyify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+/g, '-')
}

/** Rate (0..1) as `12.4%`. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/** `12.4% (10.1–15.0%)`; without an interval just the rate. */
export function formatRateWithInterval(
  rate: number,
  interval: { lower: number; upper: number } | null,
): string {
  if (!interval) return formatRate(rate)
  return `${formatRate(rate)} (${(interval.lower * 100).toFixed(1)}–${(interval.upper * 100).toFixed(1)}%)`
}

/** Three decimals, or `< 0.001` for tiny values. */
export function formatPValue(p: number): string {
  return p < 0.001 ? '< 0.001' : p.toFixed(3)
}

/** Absolute lift in percentage points: `+2.1 pp`. */
export function formatLiftPoints(lift: number): string {
  const points = lift * 100
  const text = Math.abs(points).toFixed(1)
  return `${points > 0 ? '+' : points < 0 ? '−' : ''}${text} pp`
}

export function formatRelativeLift(relative: number): string {
  const percent = relative * 100
  const text = Math.abs(percent).toFixed(1)
  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${text}%`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function allocationTotal(allocation: RolloutVariation[]): number {
  return sumWeights(allocation)
}

export function allocationIsComplete(allocation: RolloutVariation[]): boolean {
  return Math.abs(allocationTotal(allocation) - 100) <= WEIGHT_TOLERANCE
}

/** Allocation over every variant of the flag; variants not in `allocation` get weight 0. */
export function allocationForFlag(
  flag: Pick<FlagOption, 'variants'>,
  allocation: RolloutVariation[],
): RolloutVariation[] {
  return flag.variants.map((variant) => ({
    variant: variant.key,
    weight: allocation.find((a) => a.variant === variant.key)?.weight ?? 0,
  }))
}

/** A sensible control: a variant called `control`, the `false` of a boolean flag, else the first. */
export function defaultControl(flag: FlagOption): string {
  return (
    flag.variants.find((v) => v.key === 'control')?.key ??
    (flag.type === 'boolean' ? flag.variants.find((v) => v.value === false)?.key : undefined) ??
    flag.variants[0]?.key ??
    ''
  )
}
