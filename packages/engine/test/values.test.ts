import { describe, expect, it } from 'vitest'
import type { FlagType } from '../src/types'
import { isJsonValue, valueMatchesType } from '../src/values'

describe('valueMatchesType', () => {
  const cases: Array<[FlagType, unknown, boolean]> = [
    ['boolean', true, true],
    ['boolean', false, true],
    ['boolean', 'true', false],
    ['boolean', 0, false],
    ['boolean', null, false],
    ['string', '', true],
    ['string', 'blue', true],
    ['string', 1, false],
    ['string', null, false],
    ['number', 0, true],
    ['number', -1.5, true],
    ['number', Number.NaN, false],
    ['number', Number.POSITIVE_INFINITY, false],
    ['number', '1', false],
    ['json', { a: [1, 'two', null, { b: true }] }, true],
    ['json', [1, 2], true],
    ['json', 'string', true],
    ['json', 1, true],
    ['json', false, true],
    ['json', null, true],
    ['json', undefined, false],
    ['json', { a: undefined }, false],
    ['json', { a: Number.NaN }, false],
    ['json', () => 1, false],
    ['json', new Date(0), false],
  ]

  it.each(cases)('%s accepts %j: %s', (type, value, expected) => {
    expect(valueMatchesType(value, type)).toBe(expected)
  })

  it('rejects unknown flag types', () => {
    expect(valueMatchesType(true, 'bool' as FlagType)).toBe(false)
  })
})

describe('isJsonValue', () => {
  it('rejects cyclic structures instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(isJsonValue(cyclic)).toBe(false)
  })

  it('accepts shared (non-cyclic) references', () => {
    const shared = { x: 1 }
    expect(isJsonValue({ a: shared, b: shared })).toBe(true)
  })
})
