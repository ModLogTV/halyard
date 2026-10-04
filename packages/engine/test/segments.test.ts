import { describe, expect, it } from 'vitest'
import { matchRule, matchSegment } from '../src/conditions'
import type { AttributeCondition, Condition, Rule, Segment } from '../src/types'

const isPro: AttributeCondition = {
  type: 'attribute',
  attribute: 'plan',
  operator: 'eq',
  value: 'pro',
}
const inGermany: AttributeCondition = {
  type: 'attribute',
  attribute: 'country',
  operator: 'eq',
  value: 'DE',
}

const segments: Record<string, Segment> = {
  'pro-users': { key: 'pro-users', conditions: [isPro] },
  germany: { key: 'germany', conditions: [inGermany] },
  'pro-or-germany': { key: 'pro-or-germany', conditions: [isPro, inGermany], match: 'any' },
  everyone: { key: 'everyone', conditions: [] },
  nobody: { key: 'nobody', conditions: [], match: 'any' },
}

const rule = (conditions: Condition[]): Rule => ({
  id: 'r1',
  conditions,
  serve: { type: 'variant', variant: 'on' },
})

describe('matchSegment', () => {
  it('requires all conditions by default', () => {
    const segment: Segment = { key: 's', conditions: [isPro, inGermany] }
    expect(matchSegment(segment, { plan: 'pro', country: 'DE' })).toBe(true)
    expect(matchSegment(segment, { plan: 'pro', country: 'FR' })).toBe(false)
    expect(matchSegment({ ...segment, match: 'all' }, { plan: 'pro', country: 'FR' })).toBe(false)
  })

  it('requires any condition with match "any"', () => {
    const segment = segments['pro-or-germany']!
    expect(matchSegment(segment, { plan: 'pro', country: 'FR' })).toBe(true)
    expect(matchSegment(segment, { plan: 'free', country: 'DE' })).toBe(true)
    expect(matchSegment(segment, { plan: 'free', country: 'FR' })).toBe(false)
  })

  it('matches everyone with no conditions and "all", nobody with "any"', () => {
    expect(matchSegment(segments.everyone!, {})).toBe(true)
    expect(matchSegment(segments.nobody!, { plan: 'pro' })).toBe(false)
  })

  it('ignores nested segment references (segments may not reference segments)', () => {
    const nested = {
      key: 'nested',
      conditions: [{ type: 'segment', segmentKey: 'everyone' }],
    } as unknown as Segment
    expect(matchSegment(nested, {})).toBe(false)
  })

  it('never throws for malformed segments and matches nobody', () => {
    expect(matchSegment({ key: 'x' } as unknown as Segment, {})).toBe(false)
    expect(matchSegment(null as unknown as Segment, {})).toBe(false)
  })
})

describe('matchRule', () => {
  it('matches every context when the rule has no conditions', () => {
    expect(matchRule(rule([]), {}, segments)).toEqual({ matched: true, matchedSegments: [] })
  })

  it('requires all attribute conditions to match', () => {
    const r = rule([isPro, inGermany])
    expect(matchRule(r, { plan: 'pro', country: 'DE' }, segments).matched).toBe(true)
    expect(matchRule(r, { plan: 'pro', country: 'AT' }, segments).matched).toBe(false)
  })

  it('matches segment conditions and reports matched segments', () => {
    const r = rule([
      { type: 'segment', segmentKey: 'pro-users' },
      { type: 'segment', segmentKey: 'germany' },
    ])
    expect(matchRule(r, { plan: 'pro', country: 'DE' }, segments)).toEqual({
      matched: true,
      matchedSegments: ['pro-users', 'germany'],
    })
    expect(matchRule(r, { plan: 'pro', country: 'FR' }, segments)).toEqual({
      matched: false,
      matchedSegments: [],
    })
  })

  it('combines segment and attribute conditions', () => {
    const r = rule([{ type: 'segment', segmentKey: 'pro-users' }, inGermany])
    expect(matchRule(r, { plan: 'pro', country: 'DE' }, segments)).toEqual({
      matched: true,
      matchedSegments: ['pro-users'],
    })
  })

  it('negates segment membership', () => {
    const r = rule([{ type: 'segment', segmentKey: 'pro-users', negate: true }])
    expect(matchRule(r, { plan: 'free' }, segments)).toEqual({ matched: true, matchedSegments: [] })
    expect(matchRule(r, { plan: 'pro' }, segments).matched).toBe(false)
    expect(
      matchRule(
        rule([{ type: 'segment', segmentKey: 'pro-users', negate: false }]),
        { plan: 'pro' },
        segments,
      ).matched,
    ).toBe(true)
  })

  it('treats a reference to an unknown segment as a false condition, even when negated', () => {
    const unknown = rule([{ type: 'segment', segmentKey: 'does-not-exist' }])
    const negated = rule([{ type: 'segment', segmentKey: 'does-not-exist', negate: true }])
    expect(matchRule(unknown, {}, segments).matched).toBe(false)
    expect(matchRule(negated, {}, segments).matched).toBe(false)
    expect(matchRule(unknown, {}, {}).matched).toBe(false)
  })

  it('does not resolve inherited properties as segments', () => {
    const r = rule([{ type: 'segment', segmentKey: 'constructor', negate: true }])
    expect(matchRule(r, {}, segments).matched).toBe(false)
  })

  it('lets multiple rules reference the same segment', () => {
    const first = rule([{ type: 'segment', segmentKey: 'pro-users' }, inGermany])
    const second = rule([{ type: 'segment', segmentKey: 'pro-users' }])
    const context = { plan: 'pro', country: 'FR' }
    expect(matchRule(first, context, segments).matched).toBe(false)
    expect(matchRule(second, context, segments)).toEqual({
      matched: true,
      matchedSegments: ['pro-users'],
    })
  })

  it('never throws for malformed rules', () => {
    const weird = [
      null,
      {},
      { conditions: null },
      { conditions: [null] },
      { conditions: [{ type: 'unknown' }] },
    ]
    for (const r of weird) {
      expect(() => matchRule(r as unknown as Rule, {}, segments)).not.toThrow()
    }
    expect(
      matchRule({ conditions: [{ type: 'unknown' }] } as unknown as Rule, {}, segments),
    ).toEqual({ matched: false, matchedSegments: [] })
    expect(matchRule(rule([]), {}, undefined as unknown as Record<string, Segment>).matched).toBe(
      true,
    )
  })
})
