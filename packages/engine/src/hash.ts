/**
 * MurmurHash3, x86 32-bit variant (Austin Appleby's `MurmurHash3_x86_32`).
 *
 * The hash is computed over the UTF-8 encoding of `input`, so it produces the
 * same result as reference implementations in other languages that hash the
 * UTF-8 bytes of a string. Lone UTF-16 surrogates are encoded as U+FFFD, which
 * matches `TextEncoder`.
 *
 * @param input string to hash
 * @param seed unsigned 32-bit seed, defaults to 0
 * @returns unsigned 32-bit integer in [0, 2^32)
 */
export function murmurhash3_32(input: string, seed = 0): number {
  const bytes = utf8Encode(input)
  const length = bytes.length
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593

  let h1 = seed >>> 0
  const blockEnd = length & ~3

  for (let i = 0; i < blockEnd; i += 4) {
    let k1 = bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)
    k1 = Math.imul(k1, c1)
    k1 = rotl32(k1, 15)
    k1 = Math.imul(k1, c2)

    h1 ^= k1
    h1 = rotl32(h1, 13)
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0
  }

  const tail = length & 3
  if (tail > 0) {
    let k1 = 0
    if (tail === 3) k1 ^= bytes[blockEnd + 2]! << 16
    if (tail >= 2) k1 ^= bytes[blockEnd + 1]! << 8
    k1 ^= bytes[blockEnd]!
    k1 = Math.imul(k1, c1)
    k1 = rotl32(k1, 15)
    k1 = Math.imul(k1, c2)
    h1 ^= k1
  }

  h1 ^= length

  // fmix32
  h1 ^= h1 >>> 16
  h1 = Math.imul(h1, 0x85ebca6b)
  h1 ^= h1 >>> 13
  h1 = Math.imul(h1, 0xc2b2ae35)
  h1 ^= h1 >>> 16

  return h1 >>> 0
}

function rotl32(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r))
}

/**
 * Minimal UTF-8 encoder. `TextEncoder` is not part of the ECMAScript standard
 * library, so we do not rely on it to stay runtime agnostic.
 */
function utf8Encode(input: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i)

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      } else {
        code = 0xfffd
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd
    }

    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return Uint8Array.from(out)
}
