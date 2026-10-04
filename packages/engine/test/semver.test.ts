import { describe, expect, it } from 'vitest'
import { compareSemver, parseSemver } from '../src/semver'

describe('parseSemver', () => {
  it('parses major.minor.patch', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  })

  it('parses prerelease identifiers', () => {
    expect(parseSemver('1.0.0-alpha.1')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['alpha', 1],
    })
  })

  it('accepts and ignores build metadata', () => {
    expect(parseSemver('1.0.0+build.5')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] })
    expect(parseSemver('1.0.0-rc.1+sha.abc')?.prerelease).toEqual(['rc', 1])
  })

  it('accepts a leading "v" and surrounding whitespace', () => {
    expect(parseSemver('v2.0.1')).toEqual({ major: 2, minor: 0, patch: 1, prerelease: [] })
    expect(parseSemver(' 2.0.1 ')).toEqual({ major: 2, minor: 0, patch: 1, prerelease: [] })
  })

  it.each([
    '',
    '1',
    '1.2',
    '1.2.3.4',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-',
    '1.2.3-01',
    '1.2.3-alpha..1',
    '1.2.3+',
    'a.b.c',
    '-1.2.3',
    '1.2.3 beta',
    '99999999999999999999.0.0',
  ])('rejects %j', (input) => {
    expect(parseSemver(input)).toBeUndefined()
  })
})

describe('compareSemver', () => {
  const cmp = (a: string, b: string) => compareSemver(a, b)

  it('compares numerically, not lexically', () => {
    expect(cmp('1.2.3', '1.10.0')).toBe(-1)
    expect(cmp('1.10.0', '1.2.3')).toBe(1)
    expect(cmp('10.0.0', '9.99.99')).toBe(1)
    expect(cmp('1.0.10', '1.0.9')).toBe(1)
  })

  it('returns 0 for equal versions, ignoring build metadata and a "v" prefix', () => {
    expect(cmp('1.2.3', '1.2.3')).toBe(0)
    expect(cmp('1.2.3+a', '1.2.3+b')).toBe(0)
    expect(cmp('v1.2.3', '1.2.3')).toBe(0)
  })

  it('orders a prerelease before its release', () => {
    expect(cmp('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(cmp('1.0.0', '1.0.0-alpha')).toBe(1)
    expect(cmp('1.0.0-rc.1', '0.9.9')).toBe(1)
  })

  it('follows the semver 2.0.0 precedence example', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(cmp(ordered[i]!, ordered[i + 1]!)).toBe(-1)
      expect(cmp(ordered[i + 1]!, ordered[i]!)).toBe(1)
    }
  })

  it('returns undefined when either side is invalid', () => {
    expect(cmp('1.2', '1.2.3')).toBeUndefined()
    expect(cmp('1.2.3', 'latest')).toBeUndefined()
  })
})
