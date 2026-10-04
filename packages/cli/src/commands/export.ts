import type { FlagdExport } from '../api.js'
import { type CommandSpec, connectionOptions } from '../command.js'
import { UsageError } from '../errors.js'
import { connect, writeOutput } from './shared.js'

export const exportCommand: CommandSpec = {
  name: 'export',
  summary: 'Export the project as JSON or as a flagd flag file',
  usage: 'halyard export [--out <file>] [--format json|flagd] [--environment <key>]',
  description:
    'The default JSON document contains environments, segments and flags with their targeting and can be restored with `halyard import`. --format flagd produces a flagd flag configuration for one environment.',
  options: {
    ...connectionOptions,
    out: { type: 'string', valueName: 'file', description: 'Write to a file instead of stdout' },
    format: {
      type: 'string',
      valueName: 'json|flagd',
      description: 'Output format (default: json)',
    },
    environment: {
      type: 'string',
      valueName: 'key',
      description: 'Environment to export (required for --format flagd)',
    },
    json: {
      type: 'boolean',
      description: 'Machine-readable output (the default; accepted for scripts)',
    },
  },
  examples: [
    'halyard export --out halyard.json',
    'halyard export --format flagd --environment production --out flags.flagd.json',
    'halyard export | jq ".flags[].key"',
  ],
  async run(ctx) {
    const format = ctx.string('format') ?? 'json'
    const environment = ctx.string('environment')
    if (format !== 'json' && format !== 'flagd') {
      throw new UsageError(`Unknown format "${format}": expected json or flagd.`)
    }
    if (format === 'flagd' && !environment) {
      throw new UsageError('--environment is required with --format flagd.')
    }
    if (format === 'json' && environment) {
      throw new UsageError('--environment only applies to --format flagd.')
    }

    const { client } = await connect(ctx)
    let document: unknown
    if (format === 'flagd') {
      const result: FlagdExport = await client.exportFlagd(environment as string)
      for (const warning of result.warnings ?? []) {
        ctx.info(ctx.ec.yellow(`warning: ${warning}`))
      }
      document = result.flagd
    } else {
      document = await client.exportDocument()
    }
    const target = await writeOutput(
      ctx,
      ctx.string('out'),
      `${JSON.stringify(document, null, 2)}\n`,
    )
    if (target) ctx.info(`Wrote ${ctx.string('out')}`)
    return 0
  },
}
