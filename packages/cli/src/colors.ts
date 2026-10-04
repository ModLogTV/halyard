export interface Colors {
  enabled: boolean
  bold: (s: string) => string
  dim: (s: string) => string
  red: (s: string) => string
  green: (s: string) => string
  yellow: (s: string) => string
  cyan: (s: string) => string
}

const wrap = (open: number, close: number) => (s: string) => `\u001b[${open}m${s}\u001b[${close}m`
const plain = (s: string) => s

export function createColors(enabled: boolean): Colors {
  if (!enabled) {
    return {
      enabled,
      bold: plain,
      dim: plain,
      red: plain,
      green: plain,
      yellow: plain,
      cyan: plain,
    }
  }
  return {
    enabled,
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
  }
}

/**
 * Colour is on for terminals only. `NO_COLOR` and `--no-color` switch it off,
 * `FORCE_COLOR` switches it on (for CI logs that render ANSI).
 */
export function shouldUseColor(
  stream: { isTTY: boolean },
  env: Record<string, string | undefined>,
  noColorFlag = false,
): boolean {
  if (noColorFlag) return false
  if (env.NO_COLOR) return false
  const force = env.FORCE_COLOR
  if (force !== undefined && force !== '') return force !== '0' && force !== 'false'
  return stream.isTTY && env.TERM !== 'dumb'
}
