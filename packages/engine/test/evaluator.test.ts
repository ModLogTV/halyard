import { describe, expect, it } from 'vitest'
import { createEvaluator, evaluateFlag, evaluateRuleset } from '../src/evaluate'
import type { Ruleset } from '../src/types'

const ruleset: Ruleset = {
  version: 1,
  projectKey: 'shop',
  environmentKey: 'production',
  generatedAt: '2026-01-01T00:00:00.000Z',
  segments: {
    'beta-testers': {
      key: 'beta-testers',
      conditions: [{ type: 'attribute', attribute: 'beta', operator: 'eq', value: true }],
    },
  },
  flags: {
    'new-checkout': {
      flag: {
        key: 'new-checkout',
        type: 'boolean',
        variants: [
          { key: 'on', value: true },
          { key: 'off', value: false },
        ],
      },
      config: {
        enabled: true,
        offVariant: 'off',
        rules: [
          {
            id: 'beta',
            conditions: [{ type: 'segment', segmentKey: 'beta-testers' }],
            serve: { type: 'variant', variant: 'on' },
          },
        ],
        fallthrough: { type: 'variant', variant: 'off' },
      },
    },
    'button-color': {
      flag: {
        key: 'button-color',
        type: 'string',
        variants: [
          { key: 'red', value: 'red' },
          { key: 'green', value: 'green' },
        ],
      },
      config: {
        enabled: false,
        offVariant: 'red',
        rules: [],
        fallthrough: { type: 'variant', variant: 'green' },
      },
    },
    'max-items': {
      flag: { key: 'max-items', type: 'number', variants: [{ key: 'ten', value: 10 }] },
      config: {
        enabled: true,
        offVariant: 'ten',
        rules: [],
        fallthrough: {
          type: 'rollout',
          variations: [{ variant: 'ten', weight: 100 }],
        },
      },
    },
  },
}

describe('evaluateRuleset', () => {
  it('returns one entry per flag, keyed by flag key', () => {
    const results = evaluateRuleset(ruleset, { targetingKey: 'u1', beta: true })
    expect(Object.keys(results).sort()).toEqual(['button-color', 'max-items', 'new-checkout'])
    expect(results['new-checkout']).toMatchObject({
      value: true,
      reason: 'TARGETING_MATCH',
      matchedSegments: ['beta-testers'],
    })
    expect(results['button-color']).toMatchObject({ value: 'red', reason: 'DISABLED' })
    expect(results['max-items']).toMatchObject({ value: 10, reason: 'SPLIT' })
  })

  it('isolates errors per flag', () => {
    const results = evaluateRuleset(ruleset, { beta: false })
    expect(results['new-checkout']).toMatchObject({ value: false, reason: 'STATIC' })
    expect(results['max-items']).toMatchObject({
      reason: 'ERROR',
      errorCode: 'TARGETING_KEY_MISSING',
      value: 10,
    })
  })

  it('matches evaluateFlag with the ruleset segments', () => {
    const context = { targetingKey: 'u2', beta: true }
    const results = evaluateRuleset(ruleset, context)
    for (const [key, entry] of Object.entries(ruleset.flags)) {
      expect(results[key]).toEqual(evaluateFlag({ ...entry, segments: ruleset.segments, context }))
    }
  })

  it('returns an empty object for an empty or malformed ruleset', () => {
    expect(evaluateRuleset({ ...ruleset, flags: {} }, {})).toEqual({})
    expect(evaluateRuleset(null as unknown as Ruleset, {})).toEqual({})
  })

  it('reports a malformed flag entry as an error instead of throwing', () => {
    const broken = { ...ruleset, flags: { ...ruleset.flags, broken: null } } as unknown as Ruleset
    const results = evaluateRuleset(broken, { targetingKey: 'u' })
    expect(results.broken).toMatchObject({
      flagKey: 'broken',
      reason: 'ERROR',
      errorCode: 'GENERAL',
    })
    expect(results['new-checkout']?.reason).toBe('STATIC')
  })
})

describe('createEvaluator', () => {
  const evaluator = createEvaluator(ruleset)

  it('evaluates a single flag', () => {
    expect(evaluator.evaluate('new-checkout', { targetingKey: 'u', beta: true })).toMatchObject({
      flagKey: 'new-checkout',
      value: true,
      variant: 'on',
      reason: 'TARGETING_MATCH',
      ruleId: 'beta',
      ruleIndex: 0,
    })
  })

  it('returns FLAG_NOT_FOUND for unknown flags', () => {
    const result = evaluator.evaluate('nope', { targetingKey: 'u' })
    expect(result).toEqual({
      flagKey: 'nope',
      value: null,
      reason: 'ERROR',
      errorCode: 'FLAG_NOT_FOUND',
      errorMessage: 'Flag "nope" was not found in environment "production" of project "shop"',
    })
  })

  it('does not resolve inherited object properties as flags', () => {
    expect(evaluator.evaluate('constructor', {}).errorCode).toBe('FLAG_NOT_FOUND')
    expect(evaluator.evaluate('__proto__', {}).errorCode).toBe('FLAG_NOT_FOUND')
    expect(evaluator.evaluate('toString', {}).errorCode).toBe('FLAG_NOT_FOUND')
  })

  it('evaluates all flags', () => {
    const context = { targetingKey: 'u', beta: true }
    expect(evaluator.evaluateAll(context)).toEqual(evaluateRuleset(ruleset, context))
  })

  it('never throws for a malformed ruleset', () => {
    const broken = createEvaluator(null as unknown as Ruleset)
    expect(broken.evaluate('x', {})).toMatchObject({ reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND' })
    expect(broken.evaluateAll({})).toEqual({})
  })
})
