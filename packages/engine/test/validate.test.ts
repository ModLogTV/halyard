import { describe, expect, it } from 'vitest'
import type {
  AttributeCondition,
  FlagDefinition,
  FlagEnvironmentConfig,
  JsonValue,
  Operator,
  RolloutVariation,
  Segment,
} from '../src/types'
import {
  isValidKey,
  validateCondition,
  validateEnvironmentConfig,
  validateFlagDefinition,
  validateRolloutWeights,
  validateSegment,
} from '../src/validate'

const boolFlag: FlagDefinition = {
  key: 'new-checkout',
  type: 'boolean',
  variants: [
    { key: 'on', value: true },
    { key: 'off', value: false },
  ],
}

const validConfig: FlagEnvironmentConfig = {
  enabled: true,
  offVariant: 'off',
  rules: [
    {
      id: 'pro',
      conditions: [
        { type: 'attribute', attribute: 'plan', operator: 'eq', value: 'pro' },
        { type: 'segment', segmentKey: 'beta' },
      ],
      serve: { type: 'variant', variant: 'on' },
    },
    {
      id: 'half',
      conditions: [],
      serve: {
        type: 'rollout',
        variations: [
          { variant: 'on', weight: 50 },
          { variant: 'off', weight: 50 },
        ],
        bucketBy: 'companyId',
      },
    },
  ],
  fallthrough: { type: 'variant', variant: 'off' },
  experiment: {
    key: 'exp-1',
    variations: [
      { variant: 'on', weight: 50 },
      { variant: 'off', weight: 50 },
    ],
  },
}

const cond = (operator: Operator, value?: JsonValue, attribute = 'a'): AttributeCondition =>
  value === undefined
    ? { type: 'attribute', attribute, operator }
    : { type: 'attribute', attribute, operator, value }

/** Asserts exactly one problem was reported and that it matches `pattern`. */
const expectOneProblem = (problems: string[], pattern: RegExp) => {
  expect(problems).toHaveLength(1)
  expect(problems[0]).toMatch(pattern)
}

describe('isValidKey', () => {
  it.each(['a', 'A1', '0', 'new-checkout', 'checkout_v2', 'ui.button.color', 'a-_.b'])(
    'accepts %j',
    (key) => expect(isValidKey(key)).toBe(true),
  )

  it.each(['', '-a', '_a', '.a', 'a b', 'ä', 'a/b', 'a:b', ' a'])('rejects %j', (key) =>
    expect(isValidKey(key)).toBe(false),
  )

  it('rejects non-strings', () => {
    expect(isValidKey(1 as unknown as string)).toBe(false)
  })
})

describe('validateFlagDefinition', () => {
  it('accepts a valid flag of every type', () => {
    expect(validateFlagDefinition(boolFlag)).toEqual([])
    expect(
      validateFlagDefinition({
        key: 'color',
        type: 'string',
        variants: [
          { key: 'red', value: 'red', name: 'Red', description: 'The red one' },
          { key: 'empty', value: '' },
        ],
      }),
    ).toEqual([])
    expect(
      validateFlagDefinition({ key: 'n', type: 'number', variants: [{ key: 'ten', value: 10 }] }),
    ).toEqual([])
    expect(
      validateFlagDefinition({
        key: 'j',
        type: 'json',
        variants: [
          { key: 'obj', value: { a: [1, null] } },
          { key: 'nul', value: null },
        ],
      }),
    ).toEqual([])
  })

  it('does not enforce variant keys for boolean flags', () => {
    expect(
      validateFlagDefinition({
        key: 'b',
        type: 'boolean',
        variants: [
          { key: 'enabled', value: true },
          { key: 'disabled', value: false },
          { key: 'also-enabled', value: true },
        ],
      }),
    ).toEqual([])
  })

  it('rejects an invalid flag key', () => {
    expectOneProblem(validateFlagDefinition({ ...boolFlag, key: 'new checkout' }), /flag key/i)
    expectOneProblem(validateFlagDefinition({ ...boolFlag, key: '' }), /flag key/i)
  })

  it('rejects an unknown type', () => {
    expectOneProblem(
      validateFlagDefinition({ ...boolFlag, type: 'bool' } as unknown as FlagDefinition),
      /type "bool"/,
    )
  })

  it('requires at least one variant', () => {
    expectOneProblem(validateFlagDefinition({ ...boolFlag, variants: [] }), /at least one variant/)
  })

  it('rejects empty and invalid variant keys', () => {
    expectOneProblem(
      validateFlagDefinition({ ...boolFlag, variants: [{ key: '', value: true }] }),
      /Variant 1.*empty/,
    )
    expectOneProblem(
      validateFlagDefinition({ ...boolFlag, variants: [{ key: 'o n', value: true }] }),
      /"o n" is invalid/,
    )
  })

  it('rejects duplicate variant keys', () => {
    expectOneProblem(
      validateFlagDefinition({
        ...boolFlag,
        variants: [
          { key: 'on', value: true },
          { key: 'on', value: false },
        ],
      }),
      /"on" is used more than once/,
    )
  })

  it.each<[FlagDefinition['type'], JsonValue]>([
    ['boolean', 'true'],
    ['boolean', 1],
    ['string', 1],
    ['string', null],
    ['number', '1'],
    ['number', true],
  ])('rejects a %s flag with value %j', (type, value) => {
    expectOneProblem(
      validateFlagDefinition({ key: 'f', type, variants: [{ key: 'v', value }] }),
      new RegExp(`Variant "v".*${type}`),
    )
  })

  it('rejects non-finite numbers and non-JSON values', () => {
    expectOneProblem(
      validateFlagDefinition({
        key: 'f',
        type: 'number',
        variants: [{ key: 'v', value: Number.NaN }],
      }),
      /finite number/,
    )
    expectOneProblem(
      validateFlagDefinition({
        key: 'f',
        type: 'json',
        variants: [{ key: 'v', value: { a: undefined } as unknown as JsonValue }],
      }),
      /JSON/,
    )
  })

  it('reports every problem at once', () => {
    const problems = validateFlagDefinition({
      key: '-bad',
      type: 'boolean',
      variants: [
        { key: 'on', value: 'yes' },
        { key: 'on', value: false },
      ],
    })
    expect(problems).toHaveLength(3)
  })

  it('never throws on malformed input', () => {
    for (const input of [null, undefined, 1, {}, { key: 'a', type: 'json', variants: [null] }]) {
      expect(() => validateFlagDefinition(input as unknown as FlagDefinition)).not.toThrow()
      expect(validateFlagDefinition(input as unknown as FlagDefinition).length).toBeGreaterThan(0)
    }
  })
})

describe('validateRolloutWeights', () => {
  const split = (...weights: number[]): RolloutVariation[] =>
    weights.map((weight, i) => ({ variant: `v${i}`, weight }))

  it('accepts weights summing to 100', () => {
    expect(validateRolloutWeights(split(100))).toEqual([])
    expect(validateRolloutWeights(split(50, 50))).toEqual([])
    expect(validateRolloutWeights(split(10, 20, 70))).toEqual([])
    expect(validateRolloutWeights(split(0, 100))).toEqual([])
    expect(validateRolloutWeights(split(33.333, 33.333, 33.334))).toEqual([])
    expect(validateRolloutWeights(split(0.1, 0.2, 99.7))).toEqual([])
  })

  it('allows a floating point tolerance of 1e-6', () => {
    expect(validateRolloutWeights(split(...new Array<number>(7).fill(100 / 7)))).toEqual([])
    expect(validateRolloutWeights(split(50, 50.0000005))).toEqual([])
    expect(validateRolloutWeights(split(50, 49.9999995))).toEqual([])
  })

  it('rejects sums other than 100', () => {
    expectOneProblem(validateRolloutWeights(split(50, 40)), /add up to 100.*90/)
    expectOneProblem(validateRolloutWeights(split(60, 50)), /add up to 100.*110/)
    expectOneProblem(validateRolloutWeights(split(50, 49.99999)), /add up to 100/)
  })

  it('rejects negative and non-numeric weights', () => {
    expect(validateRolloutWeights(split(-10, 110))[0]).toMatch(/Variation 1.*weight/)
    expect(validateRolloutWeights(split(Number.NaN, 100))[0]).toMatch(/weight/)
    expect(validateRolloutWeights(split(Number.POSITIVE_INFINITY))[0]).toMatch(/weight/)
    expect(
      validateRolloutWeights([{ variant: 'a', weight: '100' as unknown as number }])[0],
    ).toMatch(/weight/)
  })

  it('rejects an empty rollout', () => {
    expectOneProblem(validateRolloutWeights([]), /at least one variation/)
  })

  it('rejects variations without a variant and duplicate variants', () => {
    expectOneProblem(validateRolloutWeights([{ variant: '', weight: 100 }]), /variant is required/)
    expectOneProblem(
      validateRolloutWeights([
        { variant: 'a', weight: 50 },
        { variant: 'a', weight: 50 },
      ]),
      /"a" appears more than once/,
    )
  })

  it('never throws on malformed input', () => {
    for (const input of [null, undefined, {}, [null], [{}]]) {
      expect(() => validateRolloutWeights(input as unknown as RolloutVariation[])).not.toThrow()
      expect(validateRolloutWeights(input as unknown as RolloutVariation[]).length).toBeGreaterThan(
        0,
      )
    }
  })
})

describe('validateCondition', () => {
  it.each<[Operator, JsonValue | undefined]>([
    ['eq', 'x'],
    ['eq', 1],
    ['eq', false],
    ['neq', 'x'],
    ['in', ['a', 'b']],
    ['not_in', []],
    ['contains', 'x'],
    ['not_contains', 1],
    ['starts_with', 'x'],
    ['ends_with', 'x'],
    ['gt', 1],
    ['gte', '1.5'],
    ['lt', -1],
    ['lte', 0],
    ['regex', '^a+$'],
    ['exists', undefined],
    ['not_exists', undefined],
    ['semver_eq', '1.0.0'],
    ['semver_gt', '1.0.0-beta.1'],
    ['semver_gte', 'v2.0.0'],
    ['semver_lt', '1.2.3'],
    ['semver_lte', '1.2.3+build'],
  ])('accepts %s with %j', (operator, value) => {
    expect(validateCondition(cond(operator, value))).toEqual([])
  })

  it.each<[Operator, JsonValue | undefined, RegExp]>([
    ['eq', undefined, /requires a value/],
    ['neq', null, /requires a value/],
    ['in', 'a', /array/],
    ['not_in', undefined, /array/],
    ['contains', { a: 1 }, /string/],
    ['starts_with', undefined, /string/],
    ['gt', 'abc', /number/],
    ['lte', undefined, /number/],
    ['regex', '([', /regular expression/],
    ['regex', 1, /regular expression/],
    ['semver_gt', '1.2', /semantic version/],
    ['semver_eq', 1, /semantic version/],
  ])('rejects %s with %j', (operator, value, pattern) => {
    expectOneProblem(validateCondition(cond(operator, value)), pattern)
  })

  it('rejects unknown operators and empty attributes', () => {
    expectOneProblem(validateCondition(cond('like' as Operator, 'x')), /operator "like"/)
    expectOneProblem(validateCondition(cond('eq', 'x', '')), /attribute/)
  })

  it('checks segment references against the known segment keys', () => {
    const condition = { type: 'segment', segmentKey: 'beta' } as const
    expect(validateCondition(condition, new Set(['beta']))).toEqual([])
    expect(validateCondition(condition, ['beta'])).toEqual([])
    expectOneProblem(validateCondition(condition, []), /segment "beta" does not exist/)
    expectOneProblem(validateCondition({ type: 'segment', segmentKey: '' }, ['']), /segment key/i)
  })

  it('rejects unknown condition types', () => {
    expectOneProblem(validateCondition({ type: 'cookie' } as unknown as AttributeCondition), /type/)
  })
})

describe('validateEnvironmentConfig', () => {
  const segments = ['beta']

  it('accepts a valid config', () => {
    expect(validateEnvironmentConfig(boolFlag, validConfig, segments)).toEqual([])
    expect(validateEnvironmentConfig(boolFlag, validConfig, new Set(segments))).toEqual([])
  })

  it('accepts a minimal config', () => {
    expect(
      validateEnvironmentConfig(
        boolFlag,
        {
          enabled: false,
          offVariant: 'off',
          rules: [],
          fallthrough: { type: 'variant', variant: 'on' },
        },
        [],
      ),
    ).toEqual([])
  })

  it('requires enabled to be a boolean', () => {
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        { ...validConfig, enabled: 'yes' as unknown as boolean },
        segments,
      ),
      /enabled/,
    )
  })

  it('requires the off variant to exist', () => {
    expectOneProblem(
      validateEnvironmentConfig(boolFlag, { ...validConfig, offVariant: 'nope' }, segments),
      /Off variant "nope" does not exist/,
    )
  })

  it('requires the fallthrough variant to exist', () => {
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        { ...validConfig, fallthrough: { type: 'variant', variant: 'nope' } },
        segments,
      ),
      /Fallthrough.*"nope" does not exist/,
    )
  })

  it('validates fallthrough rollouts', () => {
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        {
          ...validConfig,
          fallthrough: {
            type: 'rollout',
            variations: [
              { variant: 'on', weight: 50 },
              { variant: 'off', weight: 40 },
            ],
          },
        },
        segments,
      ),
      /Fallthrough.*add up to 100/,
    )
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        {
          ...validConfig,
          fallthrough: { type: 'rollout', variations: [{ variant: 'nope', weight: 100 }] },
        },
        segments,
      ),
      /Fallthrough.*"nope" does not exist/,
    )
  })

  it('rejects an empty bucketBy', () => {
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        {
          ...validConfig,
          fallthrough: {
            type: 'rollout',
            variations: [{ variant: 'on', weight: 100 }],
            bucketBy: '',
          },
        },
        segments,
      ),
      /bucketBy/,
    )
  })

  it('rejects unknown serve types', () => {
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        {
          ...validConfig,
          fallthrough: { type: 'random' } as unknown as FlagEnvironmentConfig['fallthrough'],
        },
        segments,
      ),
      /Fallthrough.*serve type/,
    )
  })

  it('requires rule ids and keeps them unique', () => {
    const [first, second] = validConfig.rules
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        { ...validConfig, rules: [{ ...first!, id: '' }] },
        segments,
      ),
      /Rule 1.*id is required/,
    )
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        { ...validConfig, rules: [first!, { ...second!, id: 'pro' }] },
        segments,
      ),
      /Rule id "pro" is used more than once/,
    )
  })

  it('requires rule variants to exist', () => {
    const [first] = validConfig.rules
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        { ...validConfig, rules: [{ ...first!, serve: { type: 'variant', variant: 'nope' } }] },
        segments,
      ),
      /Rule 1 \("pro"\).*"nope" does not exist/,
    )
  })

  it('validates rule rollouts', () => {
    const [, second] = validConfig.rules
    const problems = validateEnvironmentConfig(
      boolFlag,
      {
        ...validConfig,
        rules: [
          {
            ...second!,
            serve: {
              type: 'rollout',
              variations: [
                { variant: 'on', weight: 70 },
                { variant: 'nope', weight: 20 },
              ],
            },
          },
        ],
      },
      segments,
    )
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toMatch(/Rule 1 \("half"\).*"nope" does not exist/)
    expect(problems.join('\n')).toMatch(/Rule 1 \("half"\).*add up to 100/)
  })

  it('requires referenced segments to exist', () => {
    expectOneProblem(
      validateEnvironmentConfig(boolFlag, validConfig, []),
      /Rule 1 \("pro"\), condition 2: segment "beta" does not exist/,
    )
  })

  it('validates attribute conditions in rules', () => {
    const [first] = validConfig.rules
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        { ...validConfig, rules: [{ ...first!, conditions: [cond('regex', '(')] }] },
        segments,
      ),
      /Rule 1 \("pro"\), condition 1: .*regular expression/,
    )
  })

  it('validates the experiment', () => {
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        {
          ...validConfig,
          experiment: { key: 'bad key', variations: [{ variant: 'on', weight: 100 }] },
        },
        segments,
      ),
      /Experiment key "bad key" is invalid/,
    )
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        {
          ...validConfig,
          experiment: { key: 'e', variations: [{ variant: 'nope', weight: 100 }] },
        },
        segments,
      ),
      /Experiment "e".*"nope" does not exist/,
    )
    expectOneProblem(
      validateEnvironmentConfig(
        boolFlag,
        { ...validConfig, experiment: { key: 'e', variations: [{ variant: 'on', weight: 99 }] } },
        segments,
      ),
      /Experiment "e".*add up to 100/,
    )
  })

  it('never throws on malformed input', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      {},
      { ...validConfig, rules: null },
      { ...validConfig, rules: [null] },
    ]
    for (const input of inputs) {
      expect(() =>
        validateEnvironmentConfig(boolFlag, input as FlagEnvironmentConfig, segments),
      ).not.toThrow()
      expect(
        validateEnvironmentConfig(boolFlag, input as FlagEnvironmentConfig, segments).length,
      ).toBeGreaterThan(0)
    }
    expect(() =>
      validateEnvironmentConfig(null as unknown as FlagDefinition, validConfig, segments),
    ).not.toThrow()
  })
})

describe('validateSegment', () => {
  const segment: Segment = {
    key: 'beta-testers',
    conditions: [{ type: 'attribute', attribute: 'beta', operator: 'eq', value: true }],
  }

  it('accepts valid segments', () => {
    expect(validateSegment(segment)).toEqual([])
    expect(validateSegment({ ...segment, match: 'any' })).toEqual([])
    expect(validateSegment({ ...segment, match: 'all', conditions: [] })).toEqual([])
  })

  it('rejects an invalid key', () => {
    expectOneProblem(validateSegment({ ...segment, key: 'beta testers' }), /Segment key/)
  })

  it('rejects an unknown match mode', () => {
    expectOneProblem(validateSegment({ ...segment, match: 'some' } as unknown as Segment), /match/)
  })

  it('validates conditions', () => {
    expectOneProblem(
      validateSegment({ ...segment, conditions: [cond('gt', 'many')] }),
      /Condition 1: .*number/,
    )
  })

  it('does not allow segments to reference segments', () => {
    expectOneProblem(
      validateSegment({
        ...segment,
        conditions: [{ type: 'segment', segmentKey: 'other' }],
      } as unknown as Segment),
      /cannot reference other segments/,
    )
  })

  it('never throws on malformed input', () => {
    for (const input of [
      null,
      undefined,
      {},
      { key: 'a', conditions: null },
      { key: 'a', conditions: [null] },
    ]) {
      expect(() => validateSegment(input as unknown as Segment)).not.toThrow()
      expect(validateSegment(input as unknown as Segment).length).toBeGreaterThan(0)
    }
  })
})
