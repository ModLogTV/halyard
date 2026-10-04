import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ImportResult } from '../api.js'
import { type CommandSpec, connectionOptions } from '../command.js'
import { countChanges, formatDiff, hasChanges, summarize } from '../diff-printer.js'
import { CliError, ExitCode, UsageError } from '../errors.js'
import { connect } from './shared.js'

async function loadDocument(
  ctx: Parameters<CommandSpec['run']>[0],
  file: string,
): Promise<unknown> {
  let text: string
  if (file === '-') {
    text = await ctx.rt.stdin.readAll()
  } else {
    try {
      text = await readFile(resolve(ctx.rt.cwd, file), 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new CliError(
        code === 'ENOENT'
          ? `File not found: ${file}`
          : `Could not read ${file}: ${(error as Error).message}`,
      )
    }
  }
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw new CliError(
      `${file === '-' ? 'stdin' : file} is not valid JSON: ${(error as Error).message}`,
    )
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new CliError(`${file === '-' ? 'stdin' : file} is not a Halyard export document.`)
  }
  return document
}

function printMessages(ctx: Parameters<CommandSpec['run']>[0], result: ImportResult): void {
  for (const warning of result.warnings ?? []) {
    ctx.info(ctx.ec.yellow(`warning: ${warning}`))
  }
  for (const error of result.errors ?? []) {
    ctx.info(ctx.ec.red(`error: ${error}`))
  }
}

export const importCommand: CommandSpec = {
  name: 'import',
  summary: 'Import an export document, showing a diff first',
  usage: 'halyard import <file> [--prune] [--dry-run] [--yes] [--json]',
  description:
    'Sends the document as a dry run, prints what would change and, after confirmation, applies it. Use "-" as the file to read the document from stdin (then --yes is required). With --prune, environments, segments and flags that are not in the document are deleted.',
  options: {
    ...connectionOptions,
    prune: { type: 'boolean', description: 'Delete everything that is not in the document' },
    'dry-run': { type: 'boolean', description: 'Only show the diff, change nothing' },
    yes: {
      type: 'boolean',
      short: 'y',
      description: 'Apply without asking (required when not on a terminal)',
    },
    json: { type: 'boolean', description: 'Machine-readable output: the server response as JSON' },
  },
  examples: [
    'halyard import halyard.json --dry-run',
    'halyard import halyard.json',
    'halyard import halyard.json --prune --yes',
    'halyard export --out prod.json && halyard import prod.json --json --dry-run',
  ],
  async run(ctx) {
    const [file, ...extra] = ctx.positionals
    if (!file)
      throw new UsageError(
        'Missing <file>.',
        'Usage: halyard import <file> [--prune] [--dry-run] [--yes]',
      )
    if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}".`)

    const json = ctx.flag('json')
    const dryRun = ctx.flag('dry-run')
    const prune = ctx.flag('prune')
    const document = await loadDocument(ctx, file)
    const { client } = await connect(ctx)

    // 1. Always validate and diff first.
    const preview = await client.importDocument({ document, prune, dryRun: true })
    const failed = (preview.errors ?? []).length > 0

    if (json && (dryRun || failed)) {
      ctx.print(JSON.stringify(preview, null, 2))
      return failed ? ExitCode.Validation : 0
    }
    if (!json) {
      for (const line of formatDiff(preview.diff, ctx.c)) ctx.print(line)
      printMessages(ctx, preview)
    }
    if (failed) {
      ctx.info(ctx.ec.red(`Import aborted: ${preview.errors.length} validation error(s).`))
      return ExitCode.Validation
    }
    if (!hasChanges(preview.diff)) {
      if (json) ctx.print(JSON.stringify(preview, null, 2))
      else ctx.print('Nothing to import: the instance already matches this document.')
      return 0
    }
    if (dryRun) {
      ctx.print()
      ctx.print(ctx.c.dim('Dry run: no changes were made.'))
      return 0
    }

    // 2. Confirm.
    if (!ctx.flag('yes')) {
      const interactive = ctx.rt.stdin.isTTY && !json && file !== '-'
      if (!interactive) {
        throw new CliError(
          'Refusing to apply changes without confirmation: pass --yes (or --dry-run).',
          ExitCode.Validation,
          'Confirmation needs an interactive terminal.',
        )
      }
      const counts = countChanges(preview.diff)
      const warning = prune && counts.delete > 0 ? ` This deletes ${counts.delete} item(s).` : ''
      const answer = await ctx.rt.prompt(`Apply these changes?${warning} (y/N) `)
      if (!/^y(es)?$/i.test(answer.trim())) {
        ctx.info('Aborted. No changes were made.')
        return ExitCode.Validation
      }
    }

    // 3. Apply.
    const result = await client.importDocument({ document, prune, dryRun: false })
    const applyFailed = (result.errors ?? []).length > 0 || !result.applied
    if (json) {
      ctx.print(JSON.stringify(result, null, 2))
      return applyFailed ? ExitCode.Validation : 0
    }
    printMessages(ctx, result)
    if (applyFailed) {
      ctx.info(ctx.ec.red('Import was not applied.'))
      return ExitCode.Validation
    }
    ctx.print()
    ctx.print(
      `${ctx.c.green('✓')} Import applied: ${summarize(countChanges(result.diff ?? preview.diff), ctx.c)}`,
    )
    return 0
  },
}
