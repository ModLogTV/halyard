import { describe, expect, it } from 'vitest'
import { bucketFor, pickVariation } from '../src/bucket'
import { evaluateFlag } from '../src/evaluate'
import type {
  EvaluationContext,
  EvaluationInput,
  FlagDefinition,
  FlagEnvironmentConfig,
  Rule,
  Segment,
  Serve,
} from '../src/types'

const boolFlag: FlagDefinition = {
  key: 'new-checkout',
  type: 'boolean',
  variants: [
    { key: 'on', value: true },
    { key: 'off', value: false },
  ],
}

const colorFlag: FlagDefinition = {
  key: 'button-color',
  type: 'string',
  variants: [
    { key: 'red', value: 'red' },
    { key: 'green', value: 'green' },
    { key: 'blue', value: 'blue' },
  ],
}

const config = (overrides: Partial<FlagEnvironmentConfig> = {}): FlagEnvironmentConfig => ({
  enabled: true,
  offVariant: 'off',
  rules: [],
  fallthrough: { type: 'variant', variant: 'off' },
  ...overrides,
})

const rollout = (weights: Record<string, number>, bucketBy?: string): Serve => ({
  type: 'rollout',
  variations: Object.entries(weights).map(([variant, weight]) => ({ variant, weight })),
  ...(bucketBy ? { bucketBy } : {}),
})

const rule = (id: string, conditions: Rule['conditions'], serve: Serve): Rule => ({
  id,
  conditions,
  serve,
})

const serveVariant = (variant: string): Serve => ({ type: 'variant', variant })

const isPro: Rule['conditions'][number] = {
  type: 'attribute',
  attribute: 'plan',
  operator: 'eq',
  value: 'pro',
}

const evaluate = (
  cfg: FlagEnvironmentConfig,
  context: EvaluationContext = { targetingKey: 'user-1' },
  flag: FlagDefinition = boolFlag,
  segments?: Record<string, Segment>,
) => evaluateFlag({ flag, config: cfg, context, ...(segments ? { segments } : {}) })

describe('evaluateFlag', () => {
  describe('disabled flags', () => {
    it('serves the off variant with reason DISABLED', () => {
      expect(evaluate(config({ enabled: false }))).toEqual({
        flagKey: 'new-checkout',
        value: false,
        variant: 'off',
        reason: 'DISABLED',
      })
    })

    it('ignores rules, experiments and the fallthrough', () => {
      const result = evaluate(
        config({
          enabled: false,
          rules: [rule('everyone', [], serveVariant('on'))],
          fallthrough: serveVariant('on'),
          experiment: { key: 'exp', variations: [{ variant: 'on', weight: 100 }] },
        }),
      )
      expect(result.reason).toBe('DISABLED')
      expect(result.value).toBe(false)
    })

    it('does not need a targeting key', () => {
      expect(
        evaluate(config({ enabled: false, fallthrough: rollout({ on: 50, off: 50 }) }), {}),
      ).toMatchObject({ reason: 'DISABLED', value: false })
    })
  })

  describe('rules', () => {
    it('serves the variant of a matching rule with TARGETING_MATCH', () => {
      const result = evaluate(config({ rules: [rule('pro', [isPro], serveVariant('on'))] }), {
        targetingKey: 'u',
        plan: 'pro',
      })
      expect(result).toEqual({
        flagKey: 'new-checkout',
        value: true,
        variant: 'on',
        reason: 'TARGETING_MATCH',
        ruleId: 'pro',
        ruleIndex: 0,
        matchedSegments: [],
      })
    })

    it('falls through when no rule matches', () => {
      const result = evaluate(config({ rules: [rule('pro', [isPro], serveVariant('on'))] }), {
        plan: 'free',
      })
      expect(result).toEqual({
        flagKey: 'new-checkout',
        value: false,
        variant: 'off',
        reason: 'STATIC',
      })
    })

    it('evaluates rules in order; the first match wins', () => {
      const cfg = config({
        offVariant: 'red',
        fallthrough: serveVariant('red'),
        rules: [
          rule('pro', [isPro], serveVariant('green')),
          rule('everyone', [], serveVariant('blue')),
          rule('pro-again', [isPro], serveVariant('red')),
        ],
      })
      expect(evaluate(cfg, { plan: 'pro' }, colorFlag)).toMatchObject({
        value: 'green',
        ruleId: 'pro',
        ruleIndex: 0,
      })
      expect(evaluate(cfg, { plan: 'free' }, colorFlag)).toMatchObject({
        value: 'blue',
        ruleId: 'everyone',
        ruleIndex: 1,
      })
    })

    it('matches everyone with a rule without conditions, even without a targeting key', () => {
      const cfg = config({ rules: [rule('all', [], serveVariant('on'))] })
      expect(evaluate(cfg, {})).toMatchObject({ reason: 'TARGETING_MATCH', value: true })
    })

    it('reports matched segments', () => {
      const segments: Record<string, Segment> = {
        pro: { key: 'pro', conditions: [isPro as Segment['conditions'][number]] },
        staff: {
          key: 'staff',
          conditions: [
            { type: 'attribute', attribute: 'email', operator: 'ends_with', value: '@acme.io' },
          ],
        },
      }
      const cfg = config({
        rules: [
          rule(
            'pro-non-staff',
            [
              { type: 'segment', segmentKey: 'pro' },
              { type: 'segment', segmentKey: 'staff', negate: true },
            ],
            serveVariant('on'),
          ),
        ],
      })
      expect(evaluate(cfg, { plan: 'pro', email: 'a@b.c' }, boolFlag, segments)).toMatchObject({
        reason: 'TARGETING_MATCH',
        matchedSegments: ['pro'],
      })
      expect(evaluate(cfg, { plan: 'pro', email: 'a@acme.io' }, boolFlag, segments).reason).toBe(
        'STATIC',
      )
    })

    it('treats a rule referencing an unknown segment as not matching', () => {
      const cfg = config({
        rules: [rule('ghost', [{ type: 'segment', segmentKey: 'ghost' }], serveVariant('on'))],
      })
      expect(evaluate(cfg, { targetingKey: 'u' }).reason).toBe('STATIC')
      expect(evaluate(cfg, { targetingKey: 'u' }, boolFlag, {}).reason).toBe('STATIC')
    })
  })

  describe('rollouts', () => {
    const fiftyFifty = rollout({ on: 50, off: 50 })

    it('serves a rule rollout with SPLIT, bucket and rule info', () => {
      const cfg = config({ rules: [rule('half', [], fiftyFifty)] })
      const result = evaluate(cfg, { targetingKey: 'user-1' })
      const bucket = bucketFor('new-checkout', 'user-1')
      const expected = pickVariation(
        [
          { variant: 'on', weight: 50 },
          { variant: 'off', weight: 50 },
        ],
        bucket,
      )!
      expect(result).toEqual({
        flagKey: 'new-checkout',
        value: expected.variant === 'on',
        variant: expected.variant,
        reason: 'SPLIT',
        ruleId: 'half',
        ruleIndex: 0,
        matchedSegments: [],
        bucket: bucket / 1000,
      })
    })

    it('serves a fallthrough rollout with SPLIT and no rule info', () => {
      const result = evaluate(config({ fallthrough: fiftyFifty }), { targetingKey: 'user-1' })
      expect(result.reason).toBe('SPLIT')
      expect(result.bucket).toBe(bucketFor('new-checkout', 'user-1') / 1000)
      expect(result.ruleId).toBeUndefined()
      expect(result.ruleIndex).toBeUndefined()
      expect(result.experimentKey).toBeUndefined()
    })

    it('reports the bucket as a percentage in [0, 100) with 3 decimals', () => {
      for (let i = 0; i < 200; i++) {
        const { bucket } = evaluate(config({ fallthrough: fiftyFifty }), { targetingKey: `u${i}` })
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(100)
        expect(Math.round(bucket! * 1000) / 1000).toBe(bucket)
      }
    })

    it('is sticky: the same key always gets the same variant', () => {
      const cfg = config({ fallthrough: rollout({ on: 33.3, off: 66.7 }) })
      const first = evaluate(cfg, { targetingKey: 'sticky-user' })
      for (let i = 0; i < 1000; i++) {
        expect(evaluate(cfg, { targetingKey: 'sticky-user', other: i })).toEqual(first)
      }
    })

    it('distributes different keys across variants', () => {
      const cfg = config({ fallthrough: fiftyFifty })
      const variants = new Set<string | undefined>()
      for (let i = 0; i < 100; i++) variants.add(evaluate(cfg, { targetingKey: `u${i}` }).variant)
      expect(variants).toEqual(new Set(['on', 'off']))
    })

    it('uses the same bucket (salt = flag key) for rule and fallthrough rollouts', () => {
      const viaRule = config({ rules: [rule('r', [isPro], fiftyFifty)] })
      for (let i = 0; i < 200; i++) {
        const key = `user-${i}`
        const ruleResult = evaluate(viaRule, { targetingKey: key, plan: 'pro' })
        const fallthroughResult = evaluate(viaRule, { targetingKey: key, plan: 'free' })
        expect(ruleResult.reason).toBe('SPLIT')
        expect(ruleResult.ruleId).toBe('r')
        expect(fallthroughResult.reason).toBe('STATIC')

        const viaFallthrough = evaluate(config({ fallthrough: fiftyFifty }), { targetingKey: key })
        expect(viaFallthrough.bucket).toBe(ruleResult.bucket)
        expect(viaFallthrough.variant).toBe(ruleResult.variant)
      }
    })

    it('increasing a rollout percentage only moves users into the growing variant', () => {
      const at10 = config({ fallthrough: rollout({ on: 10, off: 90 }) })
      const at20 = config({ fallthrough: rollout({ on: 20, off: 80 }) })
      for (let i = 0; i < 1000; i++) {
        const context = { targetingKey: `user-${i}` }
        if (evaluate(at10, context).value === true) expect(evaluate(at20, context).value).toBe(true)
      }
    })

    it('buckets by a custom attribute', () => {
      const cfg = config({ fallthrough: rollout({ on: 50, off: 50 }, 'companyId') })
      const a = evaluate(cfg, { targetingKey: 'alice', companyId: 'acme' })
      const b = evaluate(cfg, { targetingKey: 'bob', companyId: 'acme' })
      expect(a.bucket).toBe(bucketFor('new-checkout', 'acme') / 1000)
      expect(b.bucket).toBe(a.bucket)
      expect(b.variant).toBe(a.variant)
    })

    it('stringifies numeric and boolean bucketing attributes and supports dot paths', () => {
      const byNumber = config({ fallthrough: rollout({ on: 50, off: 50 }, 'companyId') })
      expect(evaluate(byNumber, { companyId: 42 }).bucket).toBe(
        bucketFor('new-checkout', '42') / 1000,
      )
      expect(evaluate(byNumber, { companyId: true }).bucket).toBe(
        bucketFor('new-checkout', 'true') / 1000,
      )

      const byPath = config({ fallthrough: rollout({ on: 50, off: 50 }, 'company.id') })
      expect(evaluate(byPath, { company: { id: 'acme' } }).bucket).toBe(
        bucketFor('new-checkout', 'acme') / 1000,
      )
    })

    it.each([
      ['no targeting key', {}],
      ['an empty targeting key', { targetingKey: '' }],
    ])('errors with TARGETING_KEY_MISSING for %s', (_, context) => {
      const result = evaluate(config({ fallthrough: fiftyFifty }), context)
      expect(result).toMatchObject({
        flagKey: 'new-checkout',
        value: false,
        reason: 'ERROR',
        errorCode: 'TARGETING_KEY_MISSING',
      })
      expect(result.errorMessage).toContain('targetingKey')
      expect(result.variant).toBeUndefined()
    })

    it.each([
      ['missing', { targetingKey: 'u' }],
      ['empty', { targetingKey: 'u', companyId: '' }],
      ['null', { targetingKey: 'u', companyId: null }],
      ['an object', { targetingKey: 'u', companyId: { id: 1 } }],
      ['an array', { targetingKey: 'u', companyId: ['a'] }],
    ])('errors with TARGETING_KEY_MISSING when the bucketBy attribute is %s', (_, context) => {
      const cfg = config({ rules: [rule('r', [], rollout({ on: 50, off: 50 }, 'companyId'))] })
      const result = evaluate(cfg, context as EvaluationContext)
      expect(result).toMatchObject({
        reason: 'ERROR',
        errorCode: 'TARGETING_KEY_MISSING',
        value: false,
      })
      expect(result.errorMessage).toContain('companyId')
    })

    it('errors with GENERAL when the weights do not cover the bucket', () => {
      const cfg = config({ fallthrough: rollout({ on: 0.001 }) })
      let errors = 0
      for (let i = 0; i < 100; i++) {
        const result = evaluate(cfg, { targetingKey: `user-${i}` })
        if (result.reason === 'ERROR') {
          errors++
          expect(result).toMatchObject({ errorCode: 'GENERAL', value: false })
          expect(result.errorMessage).toMatch(/weights/i)
        }
      }
      expect(errors).toBeGreaterThan(90)
    })

    it('never serves a zero-weight variant', () => {
      const cfg = config({ fallthrough: rollout({ on: 0, off: 100 }) })
      for (let i = 0; i < 500; i++) {
        expect(evaluate(cfg, { targetingKey: `user-${i}` }).variant).toBe('off')
      }
    })
  })

  describe('experiments', () => {
    const experiment = {
      key: 'checkout-test',
      variations: [
        { variant: 'on', weight: 50 },
        { variant: 'off', weight: 50 },
      ],
    }

    it('allocates contexts that reach the fallthrough with salt "<flagKey>.<experimentKey>"', () => {
      const result = evaluate(config({ experiment }), { targetingKey: 'user-7' })
      const bucket = bucketFor('new-checkout.checkout-test', 'user-7')
      const expected = pickVariation(experiment.variations, bucket)!
      expect(result).toEqual({
        flagKey: 'new-checkout',
        value: expected.variant === 'on',
        variant: expected.variant,
        reason: 'SPLIT',
        bucket: bucket / 1000,
        experimentKey: 'checkout-test',
      })
    })

    it('takes precedence over a fallthrough rollout and buckets independently of it', () => {
      const cfg = config({ fallthrough: rollout({ on: 50, off: 50 }), experiment })
      let differentBuckets = 0
      for (let i = 0; i < 100; i++) {
        const result = evaluate(cfg, { targetingKey: `user-${i}` })
        expect(result.experimentKey).toBe('checkout-test')
        if (result.bucket !== bucketFor('new-checkout', `user-${i}`) / 1000) differentBuckets++
      }
      expect(differentBuckets).toBeGreaterThan(95)
    })

    it('does not apply when a rule matched', () => {
      const cfg = config({ experiment, rules: [rule('pro', [isPro], serveVariant('on'))] })
      const result = evaluate(cfg, { targetingKey: 'u', plan: 'pro' })
      expect(result.reason).toBe('TARGETING_MATCH')
      expect(result.experimentKey).toBeUndefined()
    })

    it('supports bucketBy', () => {
      const cfg = config({ experiment: { ...experiment, bucketBy: 'orgId' } })
      const result = evaluate(cfg, { targetingKey: 'u', orgId: 'org-1' })
      expect(result.bucket).toBe(bucketFor('new-checkout.checkout-test', 'org-1') / 1000)
    })

    it('errors without a bucketing value', () => {
      expect(evaluate(config({ experiment }), {})).toMatchObject({
        reason: 'ERROR',
        errorCode: 'TARGETING_KEY_MISSING',
        value: false,
      })
    })

    it('splits roughly evenly', () => {
      const cfg = config({ experiment })
      let on = 0
      for (let i = 0; i < 10_000; i++) if (evaluate(cfg, { targetingKey: `u-${i}` }).value) on++
      expect(Math.abs(on / 100 - 50)).toBeLessThan(2)
    })
  })

  describe('flag types', () => {
    it('serves string flags', () => {
      const cfg = config({ offVariant: 'red', fallthrough: serveVariant('blue') })
      expect(evaluate(cfg, {}, colorFlag)).toMatchObject({ value: 'blue', variant: 'blue' })
    })

    it('serves number flags', () => {
      const flag: FlagDefinition = {
        key: 'max-items',
        type: 'number',
        variants: [
          { key: 'low', value: 10 },
          { key: 'high', value: 2.5e3 },
          { key: 'zero', value: 0 },
        ],
      }
      expect(
        evaluate(config({ offVariant: 'zero', fallthrough: serveVariant('high') }), {}, flag),
      ).toMatchObject({
        value: 2500,
        reason: 'STATIC',
      })
      expect(evaluate(config({ enabled: false, offVariant: 'zero' }), {}, flag).value).toBe(0)
    })

    it('serves json flags including objects, arrays and primitives', () => {
      const flag: FlagDefinition = {
        key: 'layout',
        type: 'json',
        variants: [
          { key: 'object', value: { columns: 3, items: ['a', { b: null }], dark: true } },
          { key: 'array', value: [1, 2, 3] },
          { key: 'string', value: 'plain' },
          { key: 'null', value: null },
        ],
      }
      const cfg = (variant: string) =>
        config({ offVariant: 'null', fallthrough: serveVariant(variant) })
      expect(evaluate(cfg('object'), {}, flag).value).toEqual({
        columns: 3,
        items: ['a', { b: null }],
        dark: true,
      })
      expect(evaluate(cfg('array'), {}, flag).value).toEqual([1, 2, 3])
      expect(evaluate(cfg('string'), {}, flag).value).toBe('plain')
      expect(evaluate(cfg('null'), {}, flag)).toMatchObject({ value: null, reason: 'STATIC' })
    })

    it('errors with TYPE_MISMATCH when the served value does not match the flag type', () => {
      const flag: FlagDefinition = {
        key: 'broken',
        type: 'boolean',
        variants: [
          { key: 'off', value: false },
          { key: 'yes', value: 'yes' },
        ],
      }
      const result = evaluate(config({ fallthrough: serveVariant('yes') }), {}, flag)
      expect(result).toMatchObject({
        flagKey: 'broken',
        reason: 'ERROR',
        errorCode: 'TYPE_MISMATCH',
        value: false,
      })
      expect(result.errorMessage).toContain('"yes"')
      expect(result.variant).toBeUndefined()
    })

    it.each([
      ['number', 'numeric string', '42'],
      ['string', 'number', 42],
      ['number', 'boolean', true],
      ['string', 'object', { a: 1 }],
    ] as const)('rejects a %s flag serving a %s', (type, _, value) => {
      const flag = {
        key: 'f',
        type,
        variants: [
          { key: 'off', value: type === 'number' ? 0 : '' },
          { key: 'bad', value },
        ],
      } as FlagDefinition
      expect(evaluate(config({ fallthrough: serveVariant('bad') }), {}, flag).errorCode).toBe(
        'TYPE_MISMATCH',
      )
    })

    it('returns null as the error value when the off variant itself has the wrong type', () => {
      const flag: FlagDefinition = {
        key: 'broken',
        type: 'boolean',
        variants: [{ key: 'off', value: 'nope' }],
      }
      expect(evaluate(config({ enabled: false }), {}, flag)).toMatchObject({
        reason: 'ERROR',
        errorCode: 'TYPE_MISMATCH',
        value: null,
      })
    })
  })

  describe('invalid configuration', () => {
    it('errors with GENERAL and value null when the off variant does not exist', () => {
      const result = evaluate(config({ offVariant: 'missing' }))
      expect(result).toMatchObject({
        flagKey: 'new-checkout',
        reason: 'ERROR',
        errorCode: 'GENERAL',
        value: null,
      })
      expect(result.errorMessage).toContain('"missing"')
    })

    it('errors with GENERAL and value null when the flag has no variants', () => {
      const result = evaluate(config(), {}, { ...boolFlag, variants: [] })
      expect(result).toMatchObject({ reason: 'ERROR', errorCode: 'GENERAL', value: null })
      expect(result.errorMessage).toMatch(/variants/)
    })

    it('errors with GENERAL for an unknown flag type', () => {
      const flag = { ...boolFlag, type: 'bool' } as unknown as FlagDefinition
      expect(evaluate(config(), {}, flag)).toMatchObject({ reason: 'ERROR', errorCode: 'GENERAL' })
    })

    it.each<[string, Partial<FlagEnvironmentConfig>]>([
      ['a rule variant', { rules: [rule('r', [isPro], serveVariant('nope'))] }],
      ['a rule rollout variant', { rules: [rule('r', [isPro], rollout({ on: 50, nope: 50 }))] }],
      ['the fallthrough variant', { fallthrough: serveVariant('nope') }],
      ['a fallthrough rollout variant', { fallthrough: rollout({ nope: 100 }) }],
      [
        'an experiment variant',
        { experiment: { key: 'e', variations: [{ variant: 'nope', weight: 100 }] } },
      ],
    ])(
      'errors with GENERAL when %s does not exist, regardless of which path is taken',
      (_, overrides) => {
        for (const enabled of [true, false]) {
          const result = evaluate(config({ ...overrides, enabled }), {
            targetingKey: 'u',
            plan: 'free',
          })
          expect(result).toMatchObject({ reason: 'ERROR', errorCode: 'GENERAL', value: false })
          expect(result.errorMessage).toContain('"nope"')
        }
      },
    )

    it('never throws on malformed input', () => {
      const inputs: unknown[] = [
        null,
        undefined,
        {},
        { flag: null, config: null, context: null },
        { flag: boolFlag, config: null, context: {} },
        { flag: boolFlag, config: { ...config(), rules: null }, context: {} },
        { flag: boolFlag, config: { ...config(), fallthrough: null }, context: {} },
        { flag: boolFlag, config: { ...config(), rules: [null] }, context: {} },
        { flag: boolFlag, config: { ...config(), fallthrough: { type: 'weird' } }, context: {} },
        {
          flag: boolFlag,
          config: { ...config(), fallthrough: { type: 'rollout', variations: null } },
          context: { targetingKey: 'u' },
        },
        { flag: { ...boolFlag, variants: [null] }, config: config(), context: {} },
      ]
      for (const input of inputs) {
        let result: ReturnType<typeof evaluateFlag> | undefined
        expect(() => {
          result = evaluateFlag(input as EvaluationInput)
        }).not.toThrow()
        expect(result?.reason).toBe('ERROR')
        expect(result?.errorCode).toBe('GENERAL')
      }
    })

    it('evaluates a valid flag with a null context as an empty context', () => {
      const result = evaluateFlag({
        flag: boolFlag,
        config: config({ fallthrough: serveVariant('on') }),
        context: null as unknown as EvaluationContext,
      })
      expect(result).toMatchObject({ reason: 'STATIC', value: true })
    })

    it('does not mutate its input', () => {
      const cfg = config({
        rules: [rule('r', [isPro], rollout({ on: 50, off: 50 }))],
        experiment: { key: 'e', variations: [{ variant: 'on', weight: 100 }] },
      })
      const input: EvaluationInput = {
        flag: boolFlag,
        config: cfg,
        context: { targetingKey: 'u', plan: 'pro' },
      }
      const snapshot = JSON.stringify(input)
      evaluateFlag(input)
      expect(JSON.stringify(input)).toBe(snapshot)
    })
  })
})
