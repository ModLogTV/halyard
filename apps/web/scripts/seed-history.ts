/**
 * Demo evaluation history for the insights charts: hourly buckets for the last 61 days
 * with a daily rhythm, quieter weekends, slow growth, a staged rollout of the new payment
 * flow and a campaign that started a few days ago. Deterministic, so every seeded
 * instance shows the same shapes. Also writes evaluation stats for the flags that the
 * main seed does not cover, so the activity panels agree with the charts.
 */
import { db } from '../src/db'
import { flagEvaluationBuckets, flagEvaluationStats } from '../src/db/schema'

const HOUR_MS = 3_600_000
const DAYS = 61

interface Pattern {
  flag: string
  environment: string
  /** Evaluations per hour at the busiest time of a weekday. */
  peak: number
  /** Share per variant, `daysAgo` days back; `''` is the share of errors. */
  shares: (daysAgo: number) => Record<string, number>
}

const PATTERNS: Pattern[] = [
  {
    flag: 'checkout.new-payment-flow',
    environment: 'production',
    peak: 300,
    shares: (daysAgo) => {
      const on = daysAgo >= 20 ? 0.05 : daysAgo >= 10 ? 0.11 : 0.18
      return { on, off: 1 - on }
    },
  },
  {
    flag: 'checkout.new-payment-flow',
    environment: 'staging',
    peak: 45,
    shares: () => ({ on: 0.55, off: 0.45 }),
  },
  {
    flag: 'checkout.new-payment-flow',
    environment: 'development',
    peak: 14,
    shares: () => ({ on: 1 }),
  },
  {
    flag: 'pricing.plan-banner',
    environment: 'production',
    peak: 260,
    shares: (daysAgo): Record<string, number> =>
      daysAgo < 6
        ? { none: 0.52, 'annual-discount': 0.33, 'black-friday': 0.15 }
        : { none: 0.66, 'annual-discount': 0.34 },
  },
  {
    flag: 'search.results-per-page',
    environment: 'production',
    peak: 190,
    shares: () => ({ small: 0.18, medium: 0.64, large: 0.176, '': 0.004 }),
  },
  {
    flag: 'search.results-per-page',
    environment: 'staging',
    peak: 22,
    shares: () => ({ medium: 0.7, large: 0.3 }),
  },
  {
    flag: 'onboarding.checklist',
    environment: 'production',
    peak: 110,
    shares: () => ({ on: 0.25, off: 0.75 }),
  },
  {
    // A handful of enterprise customers, and nobody since the day before yesterday.
    flag: 'legacy.export-csv',
    environment: 'production',
    peak: 4,
    shares: (daysAgo): Record<string, number> => (daysAgo >= 2 ? { on: 1 } : {}),
  },
]

/** mulberry32: a tiny seeded PRNG, so the demo data is the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Relative traffic: quiet at 3 am, busiest at 3 pm (UTC), weekends at two thirds. */
function rhythm(time: number): number {
  const date = new Date(time)
  const daily = 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(((date.getUTCHours() - 3) / 24) * 2 * Math.PI))
  const weekday = date.getUTCDay()
  return daily * (weekday === 0 || weekday === 6 ? 0.65 : 1)
}

export async function seedEvaluationHistory(options: {
  flagId: (key: string) => string
  environmentId: (key: string) => string
  now?: number
}): Promise<number> {
  const now = options.now ?? Date.now()
  const random = seededRandom(42)
  const currentHour = now - (now % HOUR_MS)
  const rows: (typeof flagEvaluationBuckets.$inferInsert)[] = []
  const totals = new Map<string, { flagId: string; environmentId: string; count: number }>()

  for (let hoursAgo = DAYS * 24 - 1; hoursAgo >= 0; hoursAgo--) {
    const start = currentHour - hoursAgo * HOUR_MS
    const daysAgo = hoursAgo / 24
    const growth = 1 + 0.25 * (1 - daysAgo / DAYS)
    // The current hour has only just started.
    const elapsed = hoursAgo === 0 ? (now - currentHour) / HOUR_MS : 1
    for (const pattern of PATTERNS) {
      const flagId = options.flagId(pattern.flag)
      const environmentId = options.environmentId(pattern.environment)
      const volume = pattern.peak * rhythm(start) * growth * elapsed * (0.85 + 0.3 * random())
      for (const [variant, share] of Object.entries(pattern.shares(daysAgo))) {
        const count = Math.round(volume * share)
        if (count === 0) continue
        rows.push({ flagId, environmentId, bucketStart: new Date(start), variant, count })
        const key = `${flagId}:${environmentId}`
        const total = totals.get(key) ?? { flagId, environmentId, count: 0 }
        total.count += count
        totals.set(key, total)
      }
    }
  }

  for (let i = 0; i < rows.length; i += 2_000) {
    await db.insert(flagEvaluationBuckets).values(rows.slice(i, i + 2_000))
  }
  // Flags with hand-written stats in the main seed keep them.
  await db
    .insert(flagEvaluationStats)
    .values(
      [...totals.values()].map((total) => ({
        flagId: total.flagId,
        environmentId: total.environmentId,
        lastEvaluatedAt: new Date(now),
        lastVariant: null,
        sameVariantSince: new Date(now),
        evaluationCount: total.count,
      })),
    )
    .onConflictDoNothing()
  return rows.length
}
