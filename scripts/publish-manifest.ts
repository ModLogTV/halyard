/**
 * Pure helpers used by `scripts/publish.ts` to turn a workspace package.json
 * into the manifest that is uploaded to npm.
 *
 * npm itself neither rewrites `workspace:` ranges nor applies entry point
 * overrides from `publishConfig`, so we do both here (the same way pnpm does).
 */

export type Manifest = {
  name: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
  publishConfig?: Record<string, unknown>
  [key: string]: unknown
}

/** package.json fields that `publishConfig` may override at publish time. */
const OVERRIDABLE_FIELDS = [
  'bin',
  'browser',
  'exports',
  'imports',
  'main',
  'module',
  'types',
  'typings',
  'cpu',
  'os',
] as const

const DEPENDENCY_BLOCKS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

/**
 * Resolve a `workspace:` range against the version of the referenced package.
 * Non-workspace ranges are returned unchanged.
 */
export function resolveWorkspaceRange(range: string, version: string): string {
  if (!range.startsWith('workspace:')) return range
  const spec = range.slice('workspace:'.length)
  if (spec === '' || spec === '*') return version
  if (spec === '^' || spec === '~') return `${spec}${version}`
  return spec
}

export function preparePublishManifest(
  manifest: Manifest,
  workspaceVersions: Record<string, string>,
): Manifest {
  const out: Manifest = structuredClone(manifest)

  for (const block of DEPENDENCY_BLOCKS) {
    const deps = out[block]
    if (!deps) continue
    for (const [name, range] of Object.entries(deps)) {
      if (!range.startsWith('workspace:')) continue
      const version = workspaceVersions[name]
      if (!version) {
        throw new Error(
          `${manifest.name}: workspace dependency ${name} has no version in the workspace`,
        )
      }
      deps[name] = resolveWorkspaceRange(range, version)
    }
  }

  delete out.devDependencies
  delete out.scripts

  if (out.publishConfig) {
    const publishConfig = { ...out.publishConfig }
    for (const field of OVERRIDABLE_FIELDS) {
      if (field in publishConfig) {
        out[field] = publishConfig[field]
        delete publishConfig[field]
      }
    }
    out.publishConfig = publishConfig
  }

  return out
}

/**
 * Order manifests so that every package comes after the workspace packages it
 * depends on. Stable for unrelated packages; throws on cycles.
 */
export function sortByDependencies<T extends Manifest>(manifests: T[]): T[] {
  const byName = new Map(manifests.map((m) => [m.name, m]))
  const sorted: T[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (manifest: T, trail: string[]) => {
    const current = state.get(manifest.name)
    if (current === 'done') return
    if (current === 'visiting') {
      throw new Error(
        `Dependency cycle between workspace packages: ${[...trail, manifest.name].join(' -> ')}`,
      )
    }
    state.set(manifest.name, 'visiting')
    for (const block of DEPENDENCY_BLOCKS) {
      for (const name of Object.keys(manifest[block] ?? {})) {
        const dependency = byName.get(name)
        if (dependency) visit(dependency, [...trail, manifest.name])
      }
    }
    state.set(manifest.name, 'done')
    sorted.push(manifest)
  }

  for (const manifest of manifests) visit(manifest, [])
  return sorted
}
