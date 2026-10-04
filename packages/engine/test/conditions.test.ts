import { describe, expect, it } from 'vitest'
import { getAttribute, matchAttributeCondition } from '../src/conditions'
import type { AttributeCondition, EvaluationContext, JsonValue, Operator } from '../src/types'
import { OPERATORS } from '../src/types'

const cond = (attribute: string, operator: Operator, value?: JsonValue): AttributeCondition =>
  value === undefined
    ? { type: 'attribute', attribute, operator }
    : { type: 'attribute', attribute, operator, value }

const matches = (
  context: EvaluationContext,
  attribute: string,
  operator: Operator,
  value?: JsonValue,
) => matchAttributeCondition(cond(attribute, operator, value), context)

describe('getAttribute', () => {
  const context: EvaluationContext = {
    targetingKey: 'user-1',
    plan: 'pro',
    address: { country: 'DE', geo: { lat: 50.1 } },
    'app.version': '2.0.0',
    tags: ['a', 'b'],
    nothing: null,
  }

  it('reads top-level attributes including targetingKey', () => {
    expect(getAttribute(context, 'plan')).toBe('pro')
    expect(getAttribute(context, 'targetingKey')).toBe('user-1')
  })

  it('follows dot paths into nested objects', () => {
    expect(getAttribute(context, 'address.country')).toBe('DE')
    expect(getAttribute(context, 'address.geo.lat')).toBe(50.1)
  })

  it('prefers a literal top-level key containing dots', () => {
    expect(getAttribute(context, 'app.version')).toBe('2.0.0')
  })

  it('indexes arrays with numeric path segments', () => {
    expect(getAttribute(context, 'tags.1')).toBe('b')
    expect(getAttribute(context, 'tags.2')).toBeUndefined()
  })

  it('returns undefined for missing paths', () => {
    expect(getAttribute(context, 'missing')).toBeUndefined()
    expect(getAttribute(context, 'address.city')).toBeUndefined()
    expect(getAttribute(context, 'plan.length')).toBeUndefined()
    expect(getAttribute(context, 'address.')).toBeUndefined()
    expect(getAttribute(context, '')).toBeUndefined()
  })

  it('does not expose inherited properties', () => {
    expect(getAttribute(context, 'constructor')).toBeUndefined()
    expect(getAttribute(context, '__proto__')).toBeUndefined()
    expect(getAttribute(context, 'address.toString')).toBeUndefined()
    expect(getAttribute(context, 'tags.length')).toBeUndefined()
  })

  it('keeps null as a value (callers treat it as missing)', () => {
    expect(getAttribute(context, 'nothing')).toBeNull()
  })
})

describe('matchAttributeCondition', () => {
  describe('eq / neq', () => {
    it('compares strings exactly (case-sensitive)', () => {
      expect(matches({ plan: 'pro' }, 'plan', 'eq', 'pro')).toBe(true)
      expect(matches({ plan: 'pro' }, 'plan', 'eq', 'Pro')).toBe(false)
      expect(matches({ plan: 'pro' }, 'plan', 'neq', 'free')).toBe(true)
      expect(matches({ plan: 'pro' }, 'plan', 'neq', 'pro')).toBe(false)
    })

    it('compares numbers, accepting numeric strings on either side', () => {
      expect(matches({ age: 42 }, 'age', 'eq', 42)).toBe(true)
      expect(matches({ age: 42 }, 'age', 'eq', '42')).toBe(true)
      expect(matches({ age: '42' }, 'age', 'eq', 42)).toBe(true)
      expect(matches({ age: '42.0' }, 'age', 'eq', 42)).toBe(true)
      expect(matches({ age: 42 }, 'age', 'eq', 43)).toBe(false)
      expect(matches({ age: 'forty-two' }, 'age', 'eq', 42)).toBe(false)
      expect(matches({ age: 42 }, 'age', 'neq', '43')).toBe(true)
    })

    it('compares booleans with booleans and the strings "true" / "false"', () => {
      expect(matches({ beta: true }, 'beta', 'eq', true)).toBe(true)
      expect(matches({ beta: true }, 'beta', 'eq', 'true')).toBe(true)
      expect(matches({ beta: 'true' }, 'beta', 'eq', true)).toBe(true)
      expect(matches({ beta: false }, 'beta', 'eq', 'false')).toBe(true)
      expect(matches({ beta: 'false' }, 'beta', 'eq', false)).toBe(true)
      expect(matches({ beta: false }, 'beta', 'eq', true)).toBe(false)
      expect(matches({ beta: 'yes' }, 'beta', 'eq', true)).toBe(false)
      expect(matches({ beta: 1 }, 'beta', 'eq', true)).toBe(false)
      expect(matches({ beta: false }, 'beta', 'neq', true)).toBe(true)
    })

    it('compares arrays and objects structurally', () => {
      expect(matches({ tags: ['a', 'b'] }, 'tags', 'eq', ['a', 'b'])).toBe(true)
      expect(matches({ tags: ['a', 'b'] }, 'tags', 'eq', ['b', 'a'])).toBe(false)
      expect(matches({ o: { x: 1, y: [true] } }, 'o', 'eq', { y: [true], x: 1 })).toBe(true)
      expect(matches({ o: { x: 1 } }, 'o', 'eq', { x: 1, y: 2 })).toBe(false)
      expect(matches({ o: { x: 1 } }, 'o', 'eq', '[object Object]')).toBe(false)
    })

    it('treats a missing attribute as not equal', () => {
      expect(matches({}, 'plan', 'eq', 'pro')).toBe(false)
      expect(matches({}, 'plan', 'neq', 'pro')).toBe(true)
      expect(matches({ plan: null }, 'plan', 'eq', null)).toBe(false)
      expect(matches({ plan: null }, 'plan', 'neq', 'pro')).toBe(true)
    })
  })

  describe('in / not_in', () => {
    it('matches membership in an array value', () => {
      expect(matches({ country: 'DE' }, 'country', 'in', ['DE', 'AT'])).toBe(true)
      expect(matches({ country: 'FR' }, 'country', 'in', ['DE', 'AT'])).toBe(false)
      expect(matches({ country: 'FR' }, 'country', 'not_in', ['DE', 'AT'])).toBe(true)
      expect(matches({ country: 'DE' }, 'country', 'not_in', ['DE', 'AT'])).toBe(false)
    })

    it('applies eq coercion to elements', () => {
      expect(matches({ id: 7 }, 'id', 'in', ['5', '7'])).toBe(true)
      expect(matches({ id: '7' }, 'id', 'in', [5, 7])).toBe(true)
      expect(matches({ beta: true }, 'beta', 'in', ['true'])).toBe(true)
    })

    it('treats a non-array value as a single-element list', () => {
      expect(matches({ country: 'DE' }, 'country', 'in', 'DE')).toBe(true)
      expect(matches({ country: 'DE' }, 'country', 'not_in', 'AT')).toBe(true)
    })

    it('matches when an array attribute intersects the list', () => {
      expect(matches({ roles: ['dev', 'admin'] }, 'roles', 'in', ['admin'])).toBe(true)
      expect(matches({ roles: ['dev'] }, 'roles', 'in', ['admin'])).toBe(false)
      expect(matches({ roles: ['dev'] }, 'roles', 'not_in', ['admin'])).toBe(true)
      expect(matches({ roles: [] }, 'roles', 'in', ['admin'])).toBe(false)
    })

    it('handles an empty list', () => {
      expect(matches({ country: 'DE' }, 'country', 'in', [])).toBe(false)
      expect(matches({ country: 'DE' }, 'country', 'not_in', [])).toBe(true)
    })

    it('treats a missing attribute as not in the list', () => {
      expect(matches({}, 'country', 'in', ['DE'])).toBe(false)
      expect(matches({}, 'country', 'not_in', ['DE'])).toBe(true)
    })
  })

  describe('contains / not_contains', () => {
    it('checks substrings on strings', () => {
      expect(matches({ email: 'ada@example.com' }, 'email', 'contains', '@example.')).toBe(true)
      expect(matches({ email: 'ada@example.com' }, 'email', 'contains', 'EXAMPLE')).toBe(false)
      expect(matches({ email: 'ada@example.com' }, 'email', 'not_contains', '@corp.')).toBe(true)
      expect(matches({ email: 'ada@example.com' }, 'email', 'not_contains', 'ada')).toBe(false)
    })

    it('coerces numbers and booleans to strings', () => {
      expect(matches({ zip: 60311 }, 'zip', 'contains', '603')).toBe(true)
      expect(matches({ zip: '60311' }, 'zip', 'contains', 603)).toBe(true)
      expect(matches({ flag: true }, 'flag', 'contains', 'ru')).toBe(true)
    })

    it('checks membership when the attribute is an array', () => {
      expect(matches({ tags: ['beta', 'vip'] }, 'tags', 'contains', 'vip')).toBe(true)
      expect(matches({ tags: ['beta', 'vip'] }, 'tags', 'contains', 'vi')).toBe(false)
      expect(matches({ tags: ['beta', 'vip'] }, 'tags', 'not_contains', 'staff')).toBe(true)
      expect(matches({ ids: [1, 2] }, 'ids', 'contains', '2')).toBe(true)
    })

    it('is false for objects and missing values', () => {
      expect(matches({ o: { a: 1 } }, 'o', 'contains', 'a')).toBe(false)
      expect(matches({ email: 'x' }, 'email', 'contains')).toBe(false)
      expect(matches({ email: 'x' }, 'email', 'contains', { a: 1 })).toBe(false)
    })

    it('treats a missing attribute as not containing anything', () => {
      expect(matches({}, 'email', 'contains', 'a')).toBe(false)
      expect(matches({}, 'email', 'not_contains', 'a')).toBe(true)
    })
  })

  describe('starts_with / ends_with', () => {
    it('works on strings', () => {
      expect(matches({ email: 'ada@example.com' }, 'email', 'starts_with', 'ada@')).toBe(true)
      expect(matches({ email: 'ada@example.com' }, 'email', 'starts_with', 'bob@')).toBe(false)
      expect(matches({ email: 'ada@example.com' }, 'email', 'ends_with', '.com')).toBe(true)
      expect(matches({ email: 'ada@example.com' }, 'email', 'ends_with', '.org')).toBe(false)
    })

    it('coerces numbers and booleans to strings', () => {
      expect(matches({ phone: 4969123 }, 'phone', 'starts_with', '49')).toBe(true)
      expect(matches({ phone: 4969123 }, 'phone', 'ends_with', 123)).toBe(true)
      expect(matches({ b: false }, 'b', 'starts_with', 'fa')).toBe(true)
    })

    it('is false for arrays, objects and missing attributes', () => {
      expect(matches({ tags: ['ab'] }, 'tags', 'starts_with', 'a')).toBe(false)
      expect(matches({ o: { a: 1 } }, 'o', 'ends_with', '}')).toBe(false)
      expect(matches({}, 'email', 'starts_with', '')).toBe(false)
      expect(matches({}, 'email', 'ends_with', '')).toBe(false)
    })
  })

  describe('gt / gte / lt / lte', () => {
    it('compares numbers', () => {
      expect(matches({ age: 18 }, 'age', 'gt', 17)).toBe(true)
      expect(matches({ age: 18 }, 'age', 'gt', 18)).toBe(false)
      expect(matches({ age: 18 }, 'age', 'gte', 18)).toBe(true)
      expect(matches({ age: 18 }, 'age', 'gte', 19)).toBe(false)
      expect(matches({ age: 18 }, 'age', 'lt', 19)).toBe(true)
      expect(matches({ age: 18 }, 'age', 'lt', 18)).toBe(false)
      expect(matches({ age: 18 }, 'age', 'lte', 18)).toBe(true)
      expect(matches({ age: 18 }, 'age', 'lte', 17)).toBe(false)
    })

    it('accepts numeric strings on either side', () => {
      expect(matches({ age: '18' }, 'age', 'gt', 17)).toBe(true)
      expect(matches({ age: 18 }, 'age', 'lt', '18.5')).toBe(true)
      expect(matches({ score: ' -1.5e2 ' }, 'score', 'lt', -100)).toBe(true)
      expect(matches({ n: '.5' }, 'n', 'gte', 0.5)).toBe(true)
    })

    it('does not compare strings numerically when they are not numbers', () => {
      expect(matches({ age: 'abc' }, 'age', 'gt', 1)).toBe(false)
      expect(matches({ age: '' }, 'age', 'lt', 1)).toBe(false)
      expect(matches({ age: '0x10' }, 'age', 'gt', 1)).toBe(false)
      expect(matches({ age: 'Infinity' }, 'age', 'gt', 1)).toBe(false)
      expect(matches({ age: 10 }, 'age', 'gt', 'ten')).toBe(false)
    })

    it('does not treat booleans, arrays or null as numbers', () => {
      expect(matches({ b: true }, 'b', 'gt', 0)).toBe(false)
      expect(matches({ a: [5] }, 'a', 'gt', 1)).toBe(false)
      expect(matches({ a: 5 }, 'a', 'gt', null)).toBe(false)
      expect(matches({ a: 5 }, 'a', 'gt')).toBe(false)
    })

    it('is false for missing attributes', () => {
      for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
        expect(matches({}, 'age', op, 0)).toBe(false)
      }
    })
  })

  describe('regex', () => {
    it('tests the attribute against the pattern', () => {
      expect(
        matches({ email: 'ada@example.com' }, 'email', 'regex', '^[a-z]+@example\\.com$'),
      ).toBe(true)
      expect(matches({ email: 'ada@corp.com' }, 'email', 'regex', '@example\\.com$')).toBe(false)
    })

    it('is unanchored unless the pattern anchors itself', () => {
      expect(matches({ path: '/admin/users' }, 'path', 'regex', 'admin')).toBe(true)
    })

    it('coerces numbers and booleans to strings', () => {
      expect(matches({ zip: 60311 }, 'zip', 'regex', '^6\\d{4}$')).toBe(true)
      expect(matches({ b: true }, 'b', 'regex', '^true$')).toBe(true)
    })

    it('returns false for invalid patterns instead of throwing', () => {
      expect(() => matches({ a: 'x' }, 'a', 'regex', '([')).not.toThrow()
      expect(matches({ a: 'x' }, 'a', 'regex', '([')).toBe(false)
      expect(matches({ a: 'x' }, 'a', 'regex', '*')).toBe(false)
    })

    it('returns false for non-string patterns, arrays, objects and missing attributes', () => {
      expect(matches({ a: 'x' }, 'a', 'regex', 1)).toBe(false)
      expect(matches({ a: 'x' }, 'a', 'regex')).toBe(false)
      expect(matches({ a: ['x'] }, 'a', 'regex', 'x')).toBe(false)
      expect(matches({}, 'a', 'regex', '.*')).toBe(false)
    })

    it('is stateless across calls (no lastIndex leakage)', () => {
      for (let i = 0; i < 3; i++) expect(matches({ a: 'aaa' }, 'a', 'regex', 'a')).toBe(true)
    })
  })

  describe('exists / not_exists', () => {
    it('checks presence and ignores value', () => {
      expect(matches({ plan: 'pro' }, 'plan', 'exists')).toBe(true)
      expect(matches({ plan: 'pro' }, 'plan', 'exists', 'ignored')).toBe(true)
      expect(matches({ plan: 'pro' }, 'plan', 'not_exists')).toBe(false)
      expect(matches({}, 'plan', 'exists')).toBe(false)
      expect(matches({}, 'plan', 'not_exists')).toBe(true)
    })

    it('counts falsy values other than null as present', () => {
      expect(matches({ v: '' }, 'v', 'exists')).toBe(true)
      expect(matches({ v: 0 }, 'v', 'exists')).toBe(true)
      expect(matches({ v: false }, 'v', 'exists')).toBe(true)
      expect(matches({ v: [] }, 'v', 'exists')).toBe(true)
    })

    it('treats null as missing', () => {
      expect(matches({ v: null }, 'v', 'exists')).toBe(false)
      expect(matches({ v: null }, 'v', 'not_exists')).toBe(true)
    })

    it('works on nested paths and targetingKey', () => {
      expect(matches({ address: { country: 'DE' } }, 'address.country', 'exists')).toBe(true)
      expect(matches({ address: { country: 'DE' } }, 'address.city', 'not_exists')).toBe(true)
      expect(matches({ targetingKey: 'u1' }, 'targetingKey', 'exists')).toBe(true)
      expect(matches({}, 'targetingKey', 'not_exists')).toBe(true)
    })
  })

  describe('semver_*', () => {
    const v = (version: JsonValue) => ({ appVersion: version })

    it('compares versions numerically per component', () => {
      expect(matches(v('1.10.0'), 'appVersion', 'semver_gt', '1.2.3')).toBe(true)
      expect(matches(v('1.2.3'), 'appVersion', 'semver_lt', '1.10.0')).toBe(true)
      expect(matches(v('1.2.3'), 'appVersion', 'semver_gt', '1.10.0')).toBe(false)
    })

    it('implements all five operators', () => {
      expect(matches(v('2.0.0'), 'appVersion', 'semver_eq', '2.0.0')).toBe(true)
      expect(matches(v('2.0.0'), 'appVersion', 'semver_eq', 'v2.0.0+build.1')).toBe(true)
      expect(matches(v('2.0.0'), 'appVersion', 'semver_eq', '2.0.1')).toBe(false)
      expect(matches(v('2.0.0'), 'appVersion', 'semver_gte', '2.0.0')).toBe(true)
      expect(matches(v('2.0.0'), 'appVersion', 'semver_gte', '2.0.1')).toBe(false)
      expect(matches(v('2.0.0'), 'appVersion', 'semver_lte', '2.0.0')).toBe(true)
      expect(matches(v('2.0.1'), 'appVersion', 'semver_lte', '2.0.0')).toBe(false)
      expect(matches(v('2.0.0'), 'appVersion', 'semver_lt', '2.0.0')).toBe(false)
      expect(matches(v('2.0.0'), 'appVersion', 'semver_gt', '2.0.0')).toBe(false)
    })

    it('orders prereleases before the release', () => {
      expect(matches(v('1.0.0-alpha'), 'appVersion', 'semver_lt', '1.0.0')).toBe(true)
      expect(matches(v('1.0.0-alpha'), 'appVersion', 'semver_lt', '1.0.0-alpha.1')).toBe(true)
      expect(matches(v('1.0.0-beta.11'), 'appVersion', 'semver_gt', '1.0.0-beta.2')).toBe(true)
      expect(matches(v('1.0.0'), 'appVersion', 'semver_gte', '1.0.0-rc.1')).toBe(true)
    })

    it('is false when either side is not a valid version', () => {
      expect(matches(v('1.2'), 'appVersion', 'semver_lt', '2.0.0')).toBe(false)
      expect(matches(v('banana'), 'appVersion', 'semver_eq', 'banana')).toBe(false)
      expect(matches(v('1.2.3'), 'appVersion', 'semver_gt', '1')).toBe(false)
      expect(matches(v(1.2), 'appVersion', 'semver_gt', '1.0.0')).toBe(false)
      expect(matches(v('1.2.3'), 'appVersion', 'semver_gt', 1)).toBe(false)
      expect(matches({}, 'appVersion', 'semver_lt', '1.0.0')).toBe(false)
    })
  })

  describe('missing attributes', () => {
    const negative: Operator[] = ['neq', 'not_in', 'not_contains', 'not_exists']

    it.each(OPERATORS.map((op) => [op]))('%s on a missing attribute', (operator) => {
      const value: JsonValue = operator.startsWith('semver') ? '1.0.0' : ['x']
      expect(matches({}, 'missing', operator, value)).toBe(negative.includes(operator))
      expect(matches({ a: { b: 1 } }, 'a.missing', operator, value)).toBe(
        negative.includes(operator),
      )
    })
  })

  describe('robustness', () => {
    it('returns false for unknown operators', () => {
      const condition = { type: 'attribute', attribute: 'a', operator: 'like', value: 'x' }
      expect(matchAttributeCondition(condition as unknown as AttributeCondition, { a: 'x' })).toBe(
        false,
      )
    })

    it('never throws for malformed input', () => {
      const bad = [
        null,
        undefined,
        {},
        { type: 'attribute' },
        { type: 'attribute', attribute: 42, operator: 'eq', value: 1 },
        { type: 'attribute', attribute: 'a', operator: 'in', value: { x: 1 } },
      ]
      for (const condition of bad) {
        expect(() =>
          matchAttributeCondition(condition as unknown as AttributeCondition, { a: 1 }),
        ).not.toThrow()
      }
      expect(() =>
        matchAttributeCondition(cond('a', 'eq', 1), null as unknown as EvaluationContext),
      ).not.toThrow()
      expect(
        matchAttributeCondition(cond('a', 'eq', 1), null as unknown as EvaluationContext),
      ).toBe(false)
    })
  })
})
