import { describe, expect, test } from 'bun:test'
import {
  preparePublishManifest,
  resolveWorkspaceRange,
  sortByDependencies,
  tagEvent,
} from './publish-manifest'

const versions = { '@modlogtv/halyard-engine': '0.3.1' }

describe('resolveWorkspaceRange', () => {
  test('replaces workspace:* with the exact version', () => {
    expect(resolveWorkspaceRange('workspace:*', '0.3.1')).toBe('0.3.1')
  })

  test('keeps the caret and tilde prefixes', () => {
    expect(resolveWorkspaceRange('workspace:^', '0.3.1')).toBe('^0.3.1')
    expect(resolveWorkspaceRange('workspace:~', '0.3.1')).toBe('~0.3.1')
  })

  test('keeps an explicit range after the protocol', () => {
    expect(resolveWorkspaceRange('workspace:^0.3.0', '0.3.1')).toBe('^0.3.0')
  })

  test('leaves non-workspace ranges alone', () => {
    expect(resolveWorkspaceRange('^1.2.3', '0.3.1')).toBe('^1.2.3')
  })
})

describe('preparePublishManifest', () => {
  test('rewrites workspace dependencies in every dependency block', () => {
    const out = preparePublishManifest(
      {
        name: '@modlogtv/halyard-cli',
        version: '0.3.1',
        dependencies: { '@modlogtv/halyard-engine': 'workspace:*', zod: '^4.0.0' },
        peerDependencies: { '@modlogtv/halyard-engine': 'workspace:^' },
        optionalDependencies: { '@modlogtv/halyard-engine': 'workspace:~' },
      },
      versions,
    )
    expect(out.dependencies).toEqual({ '@modlogtv/halyard-engine': '0.3.1', zod: '^4.0.0' })
    expect(out.peerDependencies).toEqual({ '@modlogtv/halyard-engine': '^0.3.1' })
    expect(out.optionalDependencies).toEqual({ '@modlogtv/halyard-engine': '~0.3.1' })
  })

  test('throws when a workspace dependency has no known version', () => {
    expect(() =>
      preparePublishManifest(
        { name: 'x', version: '1.0.0', dependencies: { '@modlogtv/missing': 'workspace:*' } },
        versions,
      ),
    ).toThrow(/@modlogtv\/missing/)
  })

  test('applies entry point overrides from publishConfig and keeps publish options', () => {
    const out = preparePublishManifest(
      {
        name: '@modlogtv/halyard-engine',
        version: '0.3.1',
        main: './src/index.ts',
        module: './src/index.ts',
        types: './src/index.ts',
        exports: { '.': { types: './src/index.ts', import: './src/index.ts' } },
        publishConfig: {
          access: 'public',
          provenance: true,
          main: './dist/index.js',
          module: './dist/index.js',
          types: './dist/index.d.ts',
          exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
        },
      },
      versions,
    )
    expect(out.main).toBe('./dist/index.js')
    expect(out.module).toBe('./dist/index.js')
    expect(out.types).toBe('./dist/index.d.ts')
    expect(out.exports).toEqual({ '.': { types: './dist/index.d.ts', import: './dist/index.js' } })
    expect(out.publishConfig).toEqual({ access: 'public', provenance: true })
  })

  test('drops devDependencies and workspace-only scripts', () => {
    const out = preparePublishManifest(
      {
        name: 'x',
        version: '1.0.0',
        devDependencies: { typescript: '^5' },
        scripts: { build: 'tsc', test: 'vitest run' },
      },
      versions,
    )
    expect(out.devDependencies).toBeUndefined()
    expect(out.scripts).toBeUndefined()
  })

  test('does not mutate the input', () => {
    const input = {
      name: 'x',
      version: '1.0.0',
      dependencies: { '@modlogtv/halyard-engine': 'workspace:*' },
    }
    preparePublishManifest(input, versions)
    expect(input.dependencies['@modlogtv/halyard-engine']).toBe('workspace:*')
  })
})

describe('sortByDependencies', () => {
  const engine = { name: '@modlogtv/halyard-engine', version: '1.0.0' }
  const cli = {
    name: '@modlogtv/halyard-cli',
    version: '1.0.0',
    dependencies: { '@modlogtv/halyard-engine': 'workspace:*' },
  }
  const plugin = {
    name: '@modlogtv/halyard-plugin',
    version: '1.0.0',
    peerDependencies: { '@modlogtv/halyard-cli': 'workspace:^' },
  }

  test('publishes dependencies before their dependents', () => {
    expect(sortByDependencies([plugin, cli, engine]).map((m) => m.name)).toEqual([
      engine.name,
      cli.name,
      plugin.name,
    ])
  })

  test('keeps the given order for unrelated packages', () => {
    const a = { name: 'a', version: '1.0.0' }
    const b = { name: 'b', version: '1.0.0' }
    expect(sortByDependencies([b, a]).map((m) => m.name)).toEqual(['b', 'a'])
  })

  test('ignores dependencies outside the workspace', () => {
    const x = { name: 'x', version: '1.0.0', dependencies: { zod: '^4' } }
    expect(sortByDependencies([x]).map((m) => m.name)).toEqual(['x'])
  })

  test('throws on a dependency cycle', () => {
    const a = { name: 'a', version: '1.0.0', dependencies: { b: 'workspace:*' } }
    const b = { name: 'b', version: '1.0.0', dependencies: { a: 'workspace:*' } }
    expect(() => sortByDependencies([a, b])).toThrow(/cycle/i)
  })
})

describe('tagEvent', () => {
  test('emits one git-tag event per line', () => {
    const line = tagEvent('@modlogtv/halyard-cli', '0.1.0')
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      type: 'git-tag',
      tag: '@modlogtv/halyard-cli@0.1.0',
      packageName: '@modlogtv/halyard-cli',
    })
  })
})
