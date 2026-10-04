import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FlagSummary, ImportResult } from '../src/api.js'
import { readConfig, saveProfile } from '../src/config.js'
import { run } from '../src/run.js'
import { generateTypes } from '../src/typegen.js'
import {
  cleanupTempDirs,
  createTestRuntime,
  fakeFetch,
  json,
  makeTempDir,
  type RecordedRequest,
  type Route,
} from './helpers.js'

cleanupTempDirs()

const URL = 'https://flags.example.com'
const KEY = 'hal_mgmt_0123456789abcdef0123456789abcdef'

const project = {
  id: 'p1',
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  environments: [
    { id: 'e1', key: 'development', name: 'Development', color: '#0f0', isProduction: false },
    { id: 'e2', key: 'production', name: 'Production', color: '#f00', isProduction: true },
  ],
}

const flags: FlagSummary[] = [
  {
    key: 'checkout.new-payment-flow',
    name: 'New payment flow',
    description: 'Replaces the legacy checkout.',
    type: 'boolean',
    variants: [
      { key: 'on', value: true },
      { key: 'off', value: false },
    ],
    tags: [],
    archived: false,
  },
  {
    key: 'old',
    name: 'Old',
    description: null,
    type: 'string',
    variants: [{ key: 'a', value: 'a' }],
    tags: [],
    archived: true,
  },
]

const emptySection = { create: [], update: [], delete: [], unchanged: 0 }
const importResult = (overrides: Partial<ImportResult> = {}): ImportResult => ({
  diff: {
    environments: emptySection,
    segments: emptySection,
    flags: {
      create: [{ key: 'new-flag', name: 'New flag' }],
      update: [{ key: 'checkout', changes: [{ field: 'name', before: 'A', after: 'B' }] }],
      delete: [{ key: 'gone' }],
      unchanged: 4,
    },
  },
  errors: [],
  warnings: [],
  applied: false,
  ...overrides,
})

const exportDoc = {
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  project: { slug: 'acme' },
  flags: [],
}

/** A server that implements the whole contract. */
function server(
  overrides: { onImport?: (req: RecordedRequest) => Response | undefined } = {},
): Route {
  return (req) => {
    const path = req.url.replace(URL, '').split('?')[0]
    if (req.headers.authorization !== `Bearer ${KEY}`) {
      return json({ error: 'unauthorized', message: 'Invalid key' }, 401)
    }
    switch (`${req.method} ${path}`) {
      case 'GET /api/v1/projects/current':
        return json(project)
      case 'GET /api/v1/flags':
        return json({ flags })
      case 'GET /api/v1/export':
        return json(exportDoc)
      case 'GET /api/v1/export/flagd':
        return json({ flagd: { flags: { a: {} } }, warnings: ['rules were simplified'] })
      case 'POST /api/v1/import': {
        const custom = overrides.onImport?.(req)
        if (custom) return custom
        const dry = (req.body as { dryRun?: boolean }).dryRun
        return json(importResult({ applied: !dry }))
      }
    }
    return undefined
  }
}

const connectionEnv = { HALYARD_URL: URL, HALYARD_API_KEY: KEY }

function setup(options: Parameters<typeof createTestRuntime>[0] = {}, route: Route = server()) {
  const { fetch, requests } = fakeFetch(route)
  const runtime = createTestRuntime({ fetch, ...options })
  return {
    ...runtime,
    requests,
    exec: (...argv: string[]) => run(argv, runtime.rt),
  }
}

const importPosts = (requests: RecordedRequest[]) => requests.filter((r) => r.method === 'POST')

describe('basics', () => {
  it('prints the version and help', async () => {
    const t = setup()
    expect(await t.exec('--version')).toBe(0)
    expect(t.stdout()).toBe('1.2.3-test\n')

    const help = setup()
    expect(await help.exec('--help')).toBe(0)
    expect(help.stdout()).toContain('Usage: halyard <command>')
    for (const name of ['login', 'logout', 'whoami', 'types', 'export', 'import']) {
      expect(help.stdout()).toContain(name)
    }
    expect(help.stdout()).toContain('Exit codes:')
    expect(help.stdout()).toContain('Examples:')

    const none = setup()
    expect(await none.exec()).toBe(0)
    expect(none.stdout()).toContain('Usage: halyard')
  })

  it('prints per-command help with examples', async () => {
    for (const argv of [
      ['import', '--help'],
      ['help', 'import'],
      ['import', '-h'],
    ]) {
      const t = setup()
      expect(await t.exec(...argv)).toBe(0)
      expect(t.stdout()).toContain('Usage: halyard import <file>')
      expect(t.stdout()).toContain('--dry-run')
      expect(t.stdout()).toContain('Examples:')
      expect(t.requests).toHaveLength(0)
    }
  })

  it('rejects unknown commands and options with exit code 1', async () => {
    const a = setup()
    expect(await a.exec('frobnicate')).toBe(1)
    expect(a.stderr()).toContain('Unknown command "frobnicate"')
    const b = setup()
    expect(await b.exec('types', '--nope')).toBe(1)
    expect(b.stderr()).toContain("Unknown option '--nope'")
    const c = setup()
    expect(await c.exec('help', 'nope')).toBe(1)
  })

  it('fails with exit code 2 when nothing is configured', async () => {
    for (const command of ['whoami', 'types', 'export', 'import']) {
      const dir = makeTempDir()
      const file = join(dir, 'doc.json')
      writeFileSync(file, '{}')
      const t = setup()
      const code = await t.exec(...(command === 'import' ? [command, file] : [command]))
      expect(code, command).toBe(2)
      expect(t.stderr()).toContain('Run `halyard login`')
      expect(t.requests).toHaveLength(0)
    }
  })
})

describe('login / whoami / logout', () => {
  it('verifies the key, prints the project and stores the profile', async () => {
    const t = setup()
    expect(await t.exec('login', '--url', `${URL}/`, '--key', KEY)).toBe(0)
    expect(t.stdout()).toContain('Acme Corp')
    expect(t.stdout()).toContain(URL)
    expect(t.requests.map((r) => r.url)).toEqual([`${URL}/api/v1/projects/current`])

    const path = join(t.configHome, 'halyard', 'config.json')
    expect((await readConfig(path)).profiles).toEqual({ default: { url: URL, key: KEY } })
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('stores several profiles', async () => {
    const t = setup()
    await t.exec('login', '--url', URL, '--key', KEY)
    await t.exec('login', '--url', URL, '--key', KEY, '--profile', 'staging')
    const config = await readConfig(join(t.configHome, 'halyard', 'config.json'))
    expect(Object.keys(config.profiles).sort()).toEqual(['default', 'staging'])
  })

  it('does not store anything when the key is rejected (exit 2)', async () => {
    const t = setup()
    expect(await t.exec('login', '--url', URL, '--key', 'hal_mgmt_wrong')).toBe(2)
    expect(t.stderr()).toContain('Invalid management key')
    expect(existsSync(join(t.configHome, 'halyard', 'config.json'))).toBe(false)
  })

  it('exits with 3 when the server is unreachable and hints at --url', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    })
    const runtime = createTestRuntime({
      fetch: async () => {
        throw refused
      },
    })
    expect(await run(['login', '--url', URL, '--key', KEY], runtime.rt)).toBe(3)
    expect(runtime.stderr()).toContain('connection refused')
    expect(runtime.stderr()).toContain('--url')
  })

  it('reads the key from stdin with --key -', async () => {
    const t = setup({ stdin: `${KEY}\n` })
    expect(await t.exec('login', '--url', URL, '--key', '-')).toBe(0)
    expect(
      (await readConfig(join(t.configHome, 'halyard', 'config.json'))).profiles.default?.key,
    ).toBe(KEY)
  })

  it('reads a piped key when --key is omitted', async () => {
    const t = setup({ stdin: KEY })
    expect(await t.exec('login', '--url', URL)).toBe(0)
    expect(t.prompts).toHaveLength(0)
  })

  it('prompts for missing values on a terminal, hiding the key', async () => {
    const t = setup({ interactive: true, answers: [URL, KEY] })
    expect(await t.exec('login')).toBe(0)
    expect(t.prompts.map((p) => p.secret)).toEqual([false, true])
    expect(t.stdout()).not.toContain(KEY)
  })

  it('requires --url when not on a terminal', async () => {
    const t = setup({ stdin: KEY })
    expect(await t.exec('login')).toBe(2)
    expect(t.stderr()).toContain('Missing --url')
  })

  it('rejects an invalid URL', async () => {
    const t = setup()
    expect(await t.exec('login', '--url', 'flags.example.com', '--key', KEY)).toBe(2)
    expect(t.stderr()).toContain('Invalid URL')
  })

  it('whoami shows the project and masks the key', async () => {
    const t = setup()
    await saveProfile(join(t.configHome, 'halyard', 'config.json'), 'default', {
      url: URL,
      key: KEY,
    })
    expect(await t.exec('whoami')).toBe(0)
    expect(t.stdout()).toContain('Acme Corp (acme)')
    expect(t.stdout()).toContain('development, production')
    expect(t.stdout()).toContain('profile "default"')
    expect(t.stdout()).not.toContain(KEY)
  })

  it('whoami --json is machine readable', async () => {
    const t = setup({ env: connectionEnv })
    expect(await t.exec('whoami', '--json')).toBe(0)
    const data = JSON.parse(t.stdout())
    expect(data.project.slug).toBe('acme')
    expect(data.url).toBe(URL)
    expect(data.key).not.toBe(KEY)
    expect(data.sources).toEqual({ url: 'env', key: 'env' })
  })

  it('logout removes the profile', async () => {
    const t = setup()
    const path = join(t.configHome, 'halyard', 'config.json')
    await saveProfile(path, 'default', { url: URL, key: KEY })
    expect(await t.exec('logout')).toBe(0)
    expect(t.stdout()).toContain('Removed profile "default"')
    expect(existsSync(path)).toBe(false)
    expect(await t.exec('logout')).toBe(0)
    expect(t.stdout()).toContain('nothing to do')
  })
})

describe('config resolution', () => {
  it('prefers flags over env over the profile', async () => {
    const seen: string[] = []
    const route: Route = (req) => {
      seen.push(`${req.url} ${req.headers.authorization}`)
      return json(project)
    }
    const t = setup(
      { env: { HALYARD_URL: 'https://env.example.com', HALYARD_API_KEY: 'hal_mgmt_env' } },
      route,
    )
    await saveProfile(join(t.configHome, 'halyard', 'config.json'), 'default', {
      url: 'https://stored.example.com',
      key: 'hal_mgmt_stored',
    })
    await t.exec('whoami')
    await t.exec('whoami', '--url', 'https://flag.example.com', '--key', 'hal_mgmt_flag')
    expect(seen).toEqual([
      'https://env.example.com/api/v1/projects/current Bearer hal_mgmt_env',
      'https://flag.example.com/api/v1/projects/current Bearer hal_mgmt_flag',
    ])
  })

  it('uses the profile selected with --profile', async () => {
    const t = setup()
    const path = join(t.configHome, 'halyard', 'config.json')
    await saveProfile(path, 'default', { url: 'https://wrong.example.com', key: 'hal_mgmt_wrong' })
    await saveProfile(path, 'prod', { url: URL, key: KEY })
    expect(await t.exec('whoami', '--profile', 'prod')).toBe(0)
    expect(await t.exec('whoami', '--profile', 'missing')).toBe(2)
    expect(t.stderr()).toContain('No profile named "missing"')
  })
})

describe('types', () => {
  it('writes the generated module to stdout', async () => {
    const t = setup({ env: connectionEnv })
    expect(await t.exec('types')).toBe(0)
    const output = t.stdout()
    expect(output).toContain('// Project: acme · 1 flag · ')
    expect(output).toContain("export const flagKeys = ['checkout.new-payment-flow'] as const")
    expect(output).not.toContain("'old'")
    expect(t.stderr()).toBe('')
    expect(t.requests.every((r) => r.method === 'GET')).toBe(true)
  })

  it('matches generateTypes for the same flags', async () => {
    const t = setup({ env: connectionEnv })
    await t.exec('types', '--include-archived', '--namespace', 'Halyard')
    const timestamp = t.stdout().match(/ · (\S+)\n/)?.[1]
    expect(t.stdout()).toBe(
      generateTypes(flags, {
        project: 'acme',
        includeArchived: true,
        namespace: 'Halyard',
        timestamp,
      }),
    )
  })

  it('writes to --out, creating directories, and reports on stderr', async () => {
    const dir = makeTempDir()
    const t = setup({ env: connectionEnv, cwd: dir })
    expect(await t.exec('types', '--out', 'src/generated/flags.ts')).toBe(0)
    const content = readFileSync(join(dir, 'src', 'generated', 'flags.ts'), 'utf8')
    expect(content).toContain('export interface Flags')
    expect(t.stdout()).toBe('')
    expect(t.stderr()).toContain('Wrote 1 flag to src/generated/flags.ts')
  })

  it('rejects an invalid namespace before any request', async () => {
    const t = setup({ env: connectionEnv })
    expect(await t.exec('types', '--namespace', 'not valid')).toBe(1)
    expect(t.requests).toHaveLength(0)
  })

  it('exits 2 when the key is invalid', async () => {
    const t = setup({ env: { ...connectionEnv, HALYARD_API_KEY: 'hal_mgmt_bad' } })
    expect(await t.exec('types')).toBe(2)
    expect(t.stdout()).toBe('')
  })
})

describe('export', () => {
  it('prints pretty JSON by default', async () => {
    const t = setup({ env: connectionEnv })
    expect(await t.exec('export')).toBe(0)
    expect(t.stdout()).toBe(`${JSON.stringify(exportDoc, null, 2)}\n`)
    expect(await t.exec('export', '--json')).toBe(0)
  })

  it('writes a file with --out', async () => {
    const dir = makeTempDir()
    const t = setup({ env: connectionEnv, cwd: dir })
    expect(await t.exec('export', '--out', 'halyard.json')).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'halyard.json'), 'utf8'))).toEqual(exportDoc)
    expect(t.stdout()).toBe('')
  })

  it('requires --environment for flagd, before talking to the server', async () => {
    const t = setup({ env: connectionEnv })
    expect(await t.exec('export', '--format', 'flagd')).toBe(1)
    expect(t.stderr()).toContain('--environment is required')
    expect(t.requests).toHaveLength(0)
  })

  it('exports flagd and prints warnings to stderr in yellow', async () => {
    const t = setup({ env: { ...connectionEnv, FORCE_COLOR: '1' } })
    expect(await t.exec('export', '--format', 'flagd', '--environment', 'production')).toBe(0)
    expect(JSON.parse(t.stdout())).toEqual({ flags: { a: {} } })
    expect(t.stderr()).toBe('\u001b[33mwarning: rules were simplified\u001b[39m\n')
    expect(t.requests.at(-1)?.url).toBe(`${URL}/api/v1/export/flagd?environment=production`)
  })

  it('does not colour warnings without a terminal', async () => {
    const t = setup({ env: connectionEnv })
    await t.exec('export', '--format', 'flagd', '--environment', 'production')
    expect(t.stderr()).toBe('warning: rules were simplified\n')
  })

  it('rejects bad option combinations', async () => {
    const a = setup({ env: connectionEnv })
    expect(await a.exec('export', '--format', 'yaml')).toBe(1)
    const b = setup({ env: connectionEnv })
    expect(await b.exec('export', '--environment', 'production')).toBe(1)
  })
})

describe('import', () => {
  function document(): { dir: string; file: string } {
    const dir = makeTempDir()
    const file = join(dir, 'halyard.json')
    writeFileSync(file, JSON.stringify(exportDoc))
    return { dir, file }
  }

  it('--dry-run sends only a dry run and prints the diff', async () => {
    const { file } = document()
    const t = setup({ env: connectionEnv })
    expect(await t.exec('import', file, '--dry-run')).toBe(0)
    expect(importPosts(t.requests)).toHaveLength(1)
    expect(importPosts(t.requests)[0]?.body).toEqual({
      document: exportDoc,
      prune: false,
      dryRun: true,
    })
    const out = t.stdout()
    expect(out).toContain('+ new-flag')
    expect(out).toContain('~ checkout')
    expect(out).toContain('name: "A" → "B"')
    expect(out).toContain('- gone')
    expect(out).toContain('= 4 unchanged')
    expect(out).toContain('1 to create, 1 to update, 1 to delete, 4 unchanged')
    expect(out).toContain('no changes were made')
    expect(t.prompts).toHaveLength(0)
  })

  it('--yes dry-runs first, then applies', async () => {
    const { file } = document()
    const t = setup({ env: connectionEnv })
    expect(await t.exec('import', file, '--yes', '--prune')).toBe(0)
    expect(importPosts(t.requests).map((r) => r.body)).toEqual([
      { document: exportDoc, prune: true, dryRun: true },
      { document: exportDoc, prune: true, dryRun: false },
    ])
    expect(t.stdout()).toContain('Import applied')
    expect(t.prompts).toHaveLength(0)
  })

  it('asks for confirmation on a terminal and applies on "y"', async () => {
    const { file } = document()
    const t = setup({ env: connectionEnv, interactive: true, answers: ['y'] })
    expect(await t.exec('import', file)).toBe(0)
    expect(t.prompts).toHaveLength(1)
    expect(t.prompts[0]?.question).toContain('Apply these changes?')
    expect(t.prompts[0]?.question).toContain('(y/N)')
    expect(importPosts(t.requests)).toHaveLength(2)
  })

  it('does not apply when the answer is not yes', async () => {
    for (const answer of ['', 'n', 'no', 'maybe']) {
      const { file } = document()
      const t = setup({ env: connectionEnv, interactive: true, answers: [answer] })
      expect(await t.exec('import', file)).toBe(1)
      expect(importPosts(t.requests)).toHaveLength(1)
      expect(t.stderr()).toContain('No changes were made')
    }
  })

  it('warns about deletions when pruning', async () => {
    const { file } = document()
    const t = setup({ env: connectionEnv, interactive: true, answers: ['n'] })
    await t.exec('import', file, '--prune')
    expect(t.prompts[0]?.question).toContain('deletes 1 item')
  })

  it('requires --yes when not on a terminal, after showing the diff', async () => {
    const { file } = document()
    const t = setup({ env: connectionEnv })
    expect(await t.exec('import', file)).toBe(1)
    expect(t.stderr()).toContain('pass --yes')
    expect(t.stdout()).toContain('+ new-flag')
    expect(importPosts(t.requests)).toHaveLength(1)
  })

  it('prints validation errors in red and exits 1 without applying', async () => {
    const { file } = document()
    const route = server({
      onImport: () =>
        json(
          importResult({
            errors: ['flags[0]: unknown variant "x"'],
            warnings: ['segment "beta" is unused'],
          }),
        ),
    })
    const t = setup({ env: { ...connectionEnv, FORCE_COLOR: '1' } }, route)
    expect(await t.exec('import', file, '--yes')).toBe(1)
    expect(t.stderr()).toContain('\u001b[31merror: flags[0]: unknown variant "x"\u001b[39m')
    expect(t.stderr()).toContain('\u001b[33mwarning: segment "beta" is unused\u001b[39m')
    expect(importPosts(t.requests)).toHaveLength(1)
  })

  it('reports when there is nothing to do', async () => {
    const { file } = document()
    const route = server({
      onImport: () =>
        json(
          importResult({
            diff: {
              environments: emptySection,
              segments: emptySection,
              flags: { ...emptySection, unchanged: 3 },
            },
          }),
        ),
    })
    const t = setup({ env: connectionEnv }, route)
    expect(await t.exec('import', file, '--yes')).toBe(0)
    expect(t.stdout()).toContain('Nothing to import')
    expect(importPosts(t.requests)).toHaveLength(1)
  })

  it('maps a 403 on import to exit code 2 with the write hint', async () => {
    const { file } = document()
    const route = server({
      onImport: () => json({ error: 'forbidden', message: 'read-only' }, 403),
    })
    const t = setup({ env: connectionEnv }, route)
    expect(await t.exec('import', file, '--yes')).toBe(2)
    expect(t.stderr()).toContain('This key cannot write')
  })

  it('maps a failing apply step to its exit code', async () => {
    const { file } = document()
    let calls = 0
    const route = server({
      onImport: () =>
        ++calls === 2 ? json({ error: 'internal', message: 'db down' }, 500) : undefined,
    })
    const t = setup({ env: connectionEnv }, route)
    expect(await t.exec('import', file, '--yes')).toBe(3)
  })

  it('--json prints the server response for dry runs', async () => {
    const { file } = document()
    const t = setup({ env: connectionEnv })
    expect(await t.exec('import', file, '--dry-run', '--json')).toBe(0)
    expect(JSON.parse(t.stdout())).toEqual(importResult())
    expect(t.stderr()).toBe('')
  })

  it('--json applies with --yes and prints only the final response', async () => {
    const { file } = document()
    const t = setup({ env: connectionEnv })
    expect(await t.exec('import', file, '--json', '--yes')).toBe(0)
    expect(JSON.parse(t.stdout())).toMatchObject({ applied: true })
    expect(importPosts(t.requests)).toHaveLength(2)
  })

  it('--json without --yes refuses to apply, even on a terminal', async () => {
    const { file } = document()
    const t = setup({ env: connectionEnv, interactive: true })
    expect(await t.exec('import', file, '--json')).toBe(1)
    expect(importPosts(t.requests)).toHaveLength(1)
    expect(t.prompts).toHaveLength(0)
  })

  it('--json exits 1 and prints the errors on validation failure', async () => {
    const { file } = document()
    const route = server({ onImport: () => json(importResult({ errors: ['bad'] })) })
    const t = setup({ env: connectionEnv }, route)
    expect(await t.exec('import', file, '--json', '--yes')).toBe(1)
    expect(JSON.parse(t.stdout()).errors).toEqual(['bad'])
  })

  it('reads the document from stdin with "-"', async () => {
    const t = setup({ env: connectionEnv, stdin: JSON.stringify(exportDoc), interactive: true })
    expect(await t.exec('import', '-', '--dry-run')).toBe(0)
    expect(importPosts(t.requests)[0]?.body).toMatchObject({ document: exportDoc })
    const u = setup({ env: connectionEnv, stdin: JSON.stringify(exportDoc), interactive: true })
    expect(await u.exec('import', '-')).toBe(1)
    expect(u.stderr()).toContain('pass --yes')
  })

  it('rejects missing, unreadable and invalid files before any request', async () => {
    const dir = makeTempDir()
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ nope')
    const list = join(dir, 'list.json')
    writeFileSync(list, '[]')
    for (const [target, message] of [
      [join(dir, 'missing.json'), 'File not found'],
      [bad, 'not valid JSON'],
      [list, 'not a Halyard export document'],
    ] as const) {
      const t = setup({ env: connectionEnv })
      expect(await t.exec('import', target)).toBe(1)
      expect(t.stderr()).toContain(message)
      expect(t.requests).toHaveLength(0)
    }
  })

  it('requires a file argument', async () => {
    const t = setup({ env: connectionEnv })
    expect(await t.exec('import')).toBe(1)
    expect(t.stderr()).toContain('Missing <file>')
  })
})
