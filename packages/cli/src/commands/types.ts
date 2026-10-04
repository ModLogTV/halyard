import { type CommandSpec, connectionOptions } from '../command.js'
import { UsageError } from '../errors.js'
import { generateTypes } from '../typegen.js'
import { connect, writeOutput } from './shared.js'

export const types: CommandSpec = {
  name: 'types',
  summary: 'Generate TypeScript types for your flags',
  usage: 'halyard types [--out <file>] [--namespace <Name>] [--include-archived]',
  description:
    'Reads the flags of the project and emits a TypeScript module with the flag keys, their value types, variant keys, code defaults and a typed OpenFeature client interface. Writes to stdout unless --out is given.',
  options: {
    ...connectionOptions,
    out: { type: 'string', valueName: 'file', description: 'Write to a file instead of stdout' },
    namespace: {
      type: 'string',
      valueName: 'Name',
      description: 'Wrap the output in `export namespace <Name> { … }`',
    },
    'include-archived': { type: 'boolean', description: 'Include archived flags' },
  },
  examples: [
    'halyard types --out src/flags.generated.ts',
    'halyard types --namespace Halyard --include-archived > flags.d.ts',
    'HALYARD_URL=https://flags.example.com HALYARD_API_KEY=hal_mgmt_… halyard types --out flags.ts',
  ],
  async run(ctx) {
    const namespace = ctx.string('namespace')
    if (namespace !== undefined && !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(namespace)) {
      throw new UsageError(`Invalid namespace "${namespace}": expected a TypeScript identifier.`)
    }
    const { client } = await connect(ctx)
    const [project, flags] = await Promise.all([client.currentProject(), client.listFlags()])
    const output = generateTypes(flags, {
      project: project.slug,
      namespace,
      includeArchived: ctx.flag('include-archived'),
    })
    const target = await writeOutput(ctx, ctx.string('out'), output)
    if (target) {
      const count = flags.filter((flag) => ctx.flag('include-archived') || !flag.archived).length
      ctx.info(`Wrote ${count} ${count === 1 ? 'flag' : 'flags'} to ${ctx.string('out')}`)
    }
    return 0
  },
}
