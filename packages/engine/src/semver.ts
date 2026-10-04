/** A parsed semantic version. Build metadata is discarded because it has no precedence. */
export interface SemVer {
  major: number
  minor: number
  patch: number
  /** Prerelease identifiers; numeric identifiers are numbers. Empty for releases. */
  prerelease: Array<string | number>
}

const NUMERIC = '0|[1-9]\\d*'
const PRERELEASE_ID = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`
const BUILD_ID = '[0-9a-zA-Z-]+'
const SEMVER_PATTERN = new RegExp(
  `^v?(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})` +
    `(?:-(${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*))?` +
    `(?:\\+${BUILD_ID}(?:\\.${BUILD_ID})*)?$`,
)

/**
 * Parses a semantic version (`major.minor.patch[-prerelease][+build]`, see
 * https://semver.org). A leading `v` and surrounding whitespace are tolerated.
 * Returns `undefined` for anything that is not a valid version.
 */
export function parseSemver(input: string): SemVer | undefined {
  const match = SEMVER_PATTERN.exec(input.trim())
  if (!match) return undefined

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return undefined
  }

  const prerelease = match[4]
    ? match[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : []
  return { major, minor, patch, prerelease }
}

/**
 * Compares two semantic versions by semver 2.0.0 precedence.
 * Returns -1, 0 or 1, or `undefined` when either version is invalid.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | undefined {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) return undefined

  return (
    compareNumbers(left.major, right.major) ||
    compareNumbers(left.minor, right.minor) ||
    compareNumbers(left.patch, right.patch) ||
    comparePrerelease(left.prerelease, right.prerelease)
  )
}

function compareNumbers(a: number, b: number): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePrerelease(a: Array<string | number>, b: Array<string | number>): -1 | 0 | 1 {
  // A release has higher precedence than any of its prereleases.
  if (a.length === 0 || b.length === 0) return compareNumbers(b.length, a.length)

  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x === y) continue
    // Numeric identifiers have lower precedence than alphanumeric ones.
    if (typeof x === 'number' && typeof y === 'number') return compareNumbers(x, y)
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return compareNumbers(a.length, b.length)
}
