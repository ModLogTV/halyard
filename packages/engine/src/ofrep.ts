import type { ResolutionReason } from './types.js'

/** Reasons defined by the OpenFeature Remote Evaluation Protocol that Halyard emits. */
export type OfrepReason = 'STATIC' | 'TARGETING_MATCH' | 'SPLIT' | 'DISABLED' | 'UNKNOWN'

/**
 * Maps an engine reason to an OFREP reason. `ERROR` becomes `UNKNOWN`; OFREP
 * conveys errors through `errorCode` / `errorDetails` instead.
 */
export function reasonToOfrep(reason: ResolutionReason): OfrepReason {
  switch (reason) {
    case 'STATIC':
    case 'TARGETING_MATCH':
    case 'SPLIT':
    case 'DISABLED':
      return reason
    default:
      return 'UNKNOWN'
  }
}
