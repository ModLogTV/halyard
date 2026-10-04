import { describe, expect, it } from 'vitest'
import { murmurhash3_32 } from '../src/hash'

/**
 * Vectors were cross-checked against a C port of Austin Appleby's reference
 * implementation (MurmurHash3_x86_32) and published vectors (e.g. the Go
 * spaolacci/murmur3 test-suite and the seed 0x9747b28c "quick brown fox" vector).
 */
const VECTORS: Array<[input: string, seed: number, expected: number]> = [
  ['', 0, 0],
  ['', 1, 0x514e28b7],
  ['', 0xffffffff, 0x81f16f39],
  ['a', 0, 0x3c2569b2],
  ['ab', 0, 0x9bbfd75f],
  ['abc', 0, 0xb3dd93fa],
  ['abcd', 0, 0x43ed676a],
  ['hello', 0, 0x248bfa47],
  ['hello', 1, 0xbb4abcad],
  ['hello', 0x2a, 0xe2dbd2e1],
  ['hello, world', 0, 0x149bbb7f],
  ['hello, world', 1, 0x6f5cb2e9],
  ['hello, world', 0x2a, 0x7ec7c6c2],
  ['The quick brown fox jumps over the lazy dog', 0, 0x2e4ff723],
  ['The quick brown fox jumps over the lazy dog', 0x9747b28c, 0x2fa826cd],
  ['The quick brown fox jumps over the lazy dog.', 0, 0xd5c48bfc],
]

describe('murmurhash3_32', () => {
  it.each(VECTORS)('hashes %j with seed %i', (input, seed, expected) => {
    expect(murmurhash3_32(input, seed)).toBe(expected)
  })

  it('defaults the seed to 0', () => {
    expect(murmurhash3_32('hello')).toBe(0x248bfa47)
  })

  it('hashes the UTF-8 bytes of multi-byte characters', () => {
    // 2-byte (U+00E4..), 3-byte (U+20AC) and 4-byte / surrogate pair (U+1F600) sequences.
    expect(murmurhash3_32('äöü', 0)).toBe(0x2dde4854)
    expect(murmurhash3_32('€', 0)).toBe(0x5b43fca5)
    expect(murmurhash3_32('😀', 0)).toBe(0xbeb42efa)
    expect(murmurhash3_32('😀', 1)).toBe(0x48aba8bd)
  })

  it('encodes lone surrogates as U+FFFD like TextEncoder', () => {
    expect(murmurhash3_32('\ud800')).toBe(murmurhash3_32('�'))
    expect(murmurhash3_32('a\udc00b')).toBe(murmurhash3_32('a�b'))
  })

  it('always returns an unsigned 32-bit integer', () => {
    for (let i = 0; i < 1000; i++) {
      const h = murmurhash3_32(`key-${i}`, i)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})
