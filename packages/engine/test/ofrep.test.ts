import { describe, expect, it } from 'vitest'
import { reasonToOfrep } from '../src/ofrep'
import type { ResolutionReason } from '../src/types'

describe('reasonToOfrep', () => {
  it.each<[ResolutionReason, string]>([
    ['STATIC', 'STATIC'],
    ['TARGETING_MATCH', 'TARGETING_MATCH'],
    ['SPLIT', 'SPLIT'],
    ['DISABLED', 'DISABLED'],
    ['ERROR', 'UNKNOWN'],
  ])('maps %s to %s', (reason, expected) => {
    expect(reasonToOfrep(reason)).toBe(expected)
  })

  it('maps unexpected input to UNKNOWN', () => {
    expect(reasonToOfrep('CACHED' as ResolutionReason)).toBe('UNKNOWN')
  })
})
