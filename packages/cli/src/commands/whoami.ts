import { type CommandSpec, connectionOptions } from '../command.js'
import { type Connection, maskKey } from '../config.js'
import { connect } from './shared.js'

function describeSources(connection: Connection): string {
  const { url, key } = connection.sources
  const label = (source: 'flag' | 'env' | 'profile') =>
    source === 'profile'
      ? `profile "${connection.profile}"`
      : source === 'flag'
        ? 'flags'
        : 'environment'
  return url === key ? label(url) : `url from ${label(url)}, key from ${label(key)}`
}

export const whoami: CommandSpec = {
  name: 'whoami',
  summary: 'Show the project the current credentials belong to',
  usage: 'halyard whoami [--json]',
  options: {
    ...connectionOptions,
    json: { type: 'boolean', description: 'Machine-readable output' },
  },
  examples: ['halyard whoami', 'halyard whoami --profile staging --json'],
  async run(ctx) {
    const { client, connection } = await connect(ctx)
    const project = await client.currentProject()
    const key = maskKey(connection.key)
    if (ctx.flag('json')) {
      ctx.print(
        JSON.stringify(
          {
            url: connection.url,
            profile: connection.profile,
            sources: connection.sources,
            key,
            project,
          },
          null,
          2,
        ),
      )
      return 0
    }
    const environments = (project.environments ?? []).map((env) => env.key).join(', ')
    ctx.print(`${ctx.c.bold('Project')}      ${project.name} (${project.slug})`)
    ctx.print(`${ctx.c.bold('URL')}          ${connection.url}`)
    ctx.print(`${ctx.c.bold('Credentials')}  ${describeSources(connection)}, key ${key}`)
    ctx.print(`${ctx.c.bold('Environments')} ${environments || '(none)'}`)
    return 0
  },
}
