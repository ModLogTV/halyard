/**
 * Publish every public workspace package whose version is not on npm yet.
 *
 * Usage:  bun run scripts/publish.ts [--dry-run]
 *
 * For each package the script writes a publish-ready package.json (see
 * publish-manifest.ts), runs `npm publish` and restores the original manifest.
 * Published packages are reported to changesets/action through the
 * CHANGESETS_OUTPUT file (the action then creates the git tag and the GitHub
 * release); outside the action a local git tag `<name>@<version>` is created.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Glob } from 'bun'
import {
  type Manifest,
  preparePublishManifest,
  sortByDependencies,
  tagEvent,
} from './publish-manifest'

const root = resolve(import.meta.dir, '..')
const dryRun = process.argv.includes('--dry-run')

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

async function workspaceDirs(): Promise<string[]> {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    workspaces: string[]
  }
  const dirs: string[] = []
  for (const pattern of rootManifest.workspaces) {
    for await (const match of new Glob(`${pattern}/package.json`).scan({ cwd: root })) {
      dirs.push(resolve(root, match, '..'))
    }
  }
  return dirs.sort()
}

async function run(cmd: string[], cwd: string, allowFailure = false) {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(`${cmd.join(' ')} failed (${exitCode})\n${stdout}${stderr}`)
  }
  return { stdout, stderr, exitCode }
}

/**
 * Run a command attached to this terminal. `npm publish` needs that for the
 * interactive 2FA step of a local publish (browser login or one-time password).
 */
async function runInteractive(cmd: string[], cwd: string) {
  const proc = Bun.spawn(cmd, { cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(`${cmd.join(' ')} failed (${exitCode})`)
}

async function isPublished(name: string, version: string): Promise<boolean> {
  const { stdout, exitCode } = await run(
    ['npm', 'view', `${name}@${version}`, 'version', '--json'],
    root,
    true,
  )
  return exitCode === 0 && stdout.trim() !== ''
}

async function main() {
  const dirs = await workspaceDirs()
  const manifests = dirs.map((dir) => ({ ...readManifest(dir), dir }))
  const versions = Object.fromEntries(manifests.map((m) => [m.name, m.version]))
  const publishable = sortByDependencies(manifests).filter((m) => !m.private)

  const published: string[] = []
  for (const { dir, ...manifest } of publishable) {
    const tag = `${manifest.name}@${manifest.version}`
    if (await isPublished(manifest.name, manifest.version)) {
      console.log(`Skipping ${tag}: already on npm`)
      continue
    }

    const manifestPath = join(dir, 'package.json')
    const original = readFileSync(manifestPath, 'utf8')
    const prepared = preparePublishManifest(manifest, versions)
    const args = ['npm', 'publish', '--access', String(prepared.publishConfig?.access ?? 'public')]
    // Provenance needs a CI identity (OIDC); local publishes run without it.
    if (process.env.CI) args.push('--provenance')
    if (dryRun) args.push('--dry-run')

    console.log(`Publishing ${tag}${dryRun ? ' (dry run)' : ''}`)
    try {
      writeFileSync(manifestPath, `${JSON.stringify(prepared, null, 2)}\n`)
      await runInteractive(args, dir)
    } finally {
      writeFileSync(manifestPath, original)
    }

    if (!dryRun) {
      if (process.env.CHANGESETS_OUTPUT) {
        appendFileSync(process.env.CHANGESETS_OUTPUT, tagEvent(manifest.name, manifest.version))
      } else {
        await run(['git', 'tag', tag, '-m', tag], root)
      }
      console.log(`New tag: ${tag}`)
    }
    published.push(tag)
  }

  if (published.length === 0) console.log('Nothing to publish.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
