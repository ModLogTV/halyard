import { type CommandSpec, connectionOptions } from '../command.js'
import {
  assertValidProfileName,
  DEFAULT_PROFILE,
  normalizeUrl,
  readConfig,
  saveProfile,
} from '../config.js'
import { CliError, ExitCode } from '../errors.js'
import { configFilePath, createApiClient, readKeyFlag } from './shared.js'

export const login: CommandSpec = {
  name: 'login',
  summary: 'Store credentials for a Halyard instance',
  usage: 'halyard login [--url <url>] [--key <key>] [--profile <name>]',
  description:
    'Verifies the management key against the instance and saves it to the config file (mode 0600). Missing values are asked for interactively; the key can also be piped on stdin.',
  options: { ...connectionOptions },
  examples: [
    'halyard login',
    'halyard login --url https://flags.example.com --key hal_mgmt_…',
    'echo "$HALYARD_KEY" | halyard login --url https://flags.example.com --profile staging',
  ],
  async run(ctx) {
    const { rt } = ctx
    const profileName = ctx.string('profile') ?? rt.env.HALYARD_PROFILE ?? DEFAULT_PROFILE
    assertValidProfileName(profileName)
    const path = configFilePath(ctx)
    const interactive = rt.stdin.isTTY

    let url = ctx.string('url') ?? (rt.env.HALYARD_URL || undefined)
    let key = (await readKeyFlag(ctx)) ?? (rt.env.HALYARD_API_KEY || undefined)

    if (!url) {
      if (!interactive) {
        throw new CliError(
          'Missing --url.',
          ExitCode.Config,
          'Pass --url <base url>, set HALYARD_URL, or run `halyard login` in a terminal.',
        )
      }
      const existing = (await readConfig(path)).profiles[profileName]
      const suffix = existing ? ` [${existing.url}]` : ''
      url = (await rt.prompt(`Halyard URL${suffix}: `)).trim() || existing?.url
      if (!url) throw new CliError('No URL given.', ExitCode.Config)
    }
    if (!key) {
      key = interactive
        ? (await rt.prompt('Management key: ', { secret: true })).trim()
        : (await rt.stdin.readAll()).trim()
      if (!key) throw new CliError('No management key given.', ExitCode.Config)
    }

    const baseUrl = normalizeUrl(url)
    if (!key.startsWith('hal_mgmt_')) {
      ctx.info(
        ctx.ec.yellow('warning: management keys start with hal_mgmt_; this key may be rejected.'),
      )
    }

    const project = await createApiClient(ctx, { url: baseUrl, key }).currentProject()
    await saveProfile(path, profileName, { url: baseUrl, key })

    ctx.print(
      `${ctx.c.green('✓')} Logged in to ${ctx.c.bold(project.name)} (${project.slug}) at ${baseUrl}`,
    )
    ctx.print(`  Profile "${profileName}" saved to ${path}`)
    return 0
  },
}
