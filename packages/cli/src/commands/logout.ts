import type { CommandSpec } from '../command.js'
import { assertValidProfileName, DEFAULT_PROFILE, removeProfile } from '../config.js'
import { configFilePath } from './shared.js'

export const logout: CommandSpec = {
  name: 'logout',
  summary: 'Remove stored credentials',
  usage: 'halyard logout [--profile <name>]',
  options: {
    profile: {
      type: 'string',
      valueName: 'name',
      description: 'Profile to remove (default: "default", env: HALYARD_PROFILE)',
    },
  },
  examples: ['halyard logout', 'halyard logout --profile staging'],
  async run(ctx) {
    const name = ctx.string('profile') ?? ctx.rt.env.HALYARD_PROFILE ?? DEFAULT_PROFILE
    assertValidProfileName(name)
    const removed = await removeProfile(configFilePath(ctx), name)
    ctx.print(removed ? `Removed profile "${name}".` : `No profile named "${name}"; nothing to do.`)
    return 0
  },
}
