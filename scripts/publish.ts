/**
 * Publish every public workspace package whose version is not on npm yet.
 *
 * Usage:  bun run scripts/publish.ts [--dry-run]
 *
 * For each package the script writes a publish-ready package.json (see
 * publish-manifest.ts), runs `npm publish`, restores the original manifest
 * and creates a git tag `<name>@<version>`. It prints `New tag: <name>@<version>`
 * lines, which changesets/action turns into GitHub releases.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Glob } from 'bun'
import { type Manifest, preparePublishManifest, sortByDependencies } from './publish-manifest'

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
  const manifests = dirs.map((dir) => ({ dir, manifest: readManifest(dir) }))
  const versions = Object.fromEntries(
    manifests.map(({ manifest }) => [manifest.name, manifest.version]),
  )
  const publishable = sortByDependencies(
    manifests.map(({ dir, manifest }) => ({ ...manifest, dir })),
  ).filter((manifest) => !manifest.private)

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
    if (prepared.publishConfig?.provenance && process.env.CI) args.push('--provenance')
    if (dryRun) args.push('--dry-run')

    console.log(`Publishing ${tag}${dryRun ? ' (dry run)' : ''}`)
    try {
      writeFileSync(manifestPath, `${JSON.stringify(prepared, null, 2)}\n`)
      const { stdout, stderr } = await run(args, dir)
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    } finally {
      writeFileSync(manifestPath, original)
    }

    if (!dryRun) {
      await run(['git', 'tag', tag, '-m', tag], root)
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
