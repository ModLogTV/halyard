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
