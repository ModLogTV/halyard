import type { RolloutVariation, Serve, Variant } from '@modlogtv/halyard-engine'

type RolloutServe = Extract<Serve, { type: 'rollout' }>

/** Splits 100% across `keys` in 0.001 steps so the weights add up to exactly 100. */
export function evenSplit(keys: string[]): RolloutVariation[] {
  const n = keys.length
  if (n === 0) return []
  const base = Math.floor(100000 / n)
  const remainder = 100000 - base * n
  return keys.map((variant, i) => ({
    variant,
    weight: (base + (i < remainder ? 1 : 0)) / 1000,
  }))
}

/** Rollout that starts at 100% on `selected`, or an even split when it is not a known variant. */
export function rolloutFrom(variants: Pick<Variant, 'key'>[], selected?: string): RolloutServe {
  const keys = variants.map((variant) => variant.key)
  if (selected && keys.includes(selected)) {
    return {
      type: 'rollout',
      variations: keys.map((variant) => ({ variant, weight: variant === selected ? 100 : 0 })),
    }
  }
  return { type: 'rollout', variations: evenSplit(keys) }
}

/** The variant a serve mostly resolves to: the fixed variant, or the heaviest rollout slice. */
export function primaryVariant(serve: Serve, variants: Pick<Variant, 'key'>[]): string {
  if (serve.type === 'variant') return serve.variant
  let best: RolloutVariation | undefined
  for (const variation of serve.variations) {
    if (!best || variation.weight > best.weight) best = variation
  }
  return best?.variant ?? variants[0]?.key ?? ''
}

export function sumWeights(variations: RolloutVariation[]): number {
  const sum = variations.reduce((total, v) => total + (Number.isFinite(v.weight) ? v.weight : 0), 0)
  return Number(sum.toFixed(6))
}
