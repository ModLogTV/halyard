import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createClient, type HalyardClient } from '../api.js'
import type { CommandContext } from '../command.js'
import { type Connection, configPath, readConfig, resolveConnection } from '../config.js'
import { CliError, ExitCode } from '../errors.js'

export function configFilePath(ctx: CommandContext): string {
  return configPath(ctx.rt.env, ctx.rt.platform, ctx.rt.homedir)
}

/** `--key -` reads the key from stdin. */
export async function readKeyFlag(ctx: CommandContext): Promise<string | undefined> {
  const key = ctx.string('key')
  if (key !== '-') return key
  const piped = (await ctx.rt.stdin.readAll()).trim()
  if (!piped)
    throw new CliError('Expected a management key on stdin, but it was empty.', ExitCode.Config)
  return piped
}

export function createApiClient(
  ctx: CommandContext,
  connection: Pick<Connection, 'url' | 'key'>,
): HalyardClient {
  return createClient({
    url: connection.url,
    key: connection.key,
    fetch: ctx.rt.fetch,
    userAgent: `halyard-cli/${ctx.rt.version}`,
  })
}

/** Resolves flags > environment > profile and builds an API client for it. */
export async function connect(
  ctx: CommandContext,
): Promise<{ client: HalyardClient; connection: Connection }> {
  const flags = {
    url: ctx.string('url'),
    key: await readKeyFlag(ctx),
    profile: ctx.string('profile'),
  }
  const config = await readConfig(configFilePath(ctx))
  const connection = resolveConnection({ flags, env: ctx.rt.env, config })
  return { client: createApiClient(ctx, connection), connection }
}

/** Writes to a file, or to stdout when `out` is undefined or `-`. */
export async function writeOutput(
  ctx: CommandContext,
  out: string | undefined,
  content: string,
): Promise<string | undefined> {
  if (out === undefined || out === '-') {
    ctx.rt.stdout.write(content)
    return undefined
  }
  const target = resolve(ctx.rt.cwd, out)
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  } catch (error) {
    throw new CliError(`Could not write ${out}: ${(error as Error).message}`)
  }
  return target
}
