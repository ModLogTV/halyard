import { parseArgs } from 'node:util'
import { type Colors, createColors, shouldUseColor } from './colors.js'
import { UsageError } from './errors.js'
import type { Runtime } from './runtime.js'

export interface OptionSpec {
  type: 'string' | 'boolean'
  short?: string
  /** Placeholder shown in the help, e.g. `file` for `--out <file>`. */
  valueName?: string
  description: string
}

export interface CommandContext {
  rt: Runtime
  positionals: string[]
  /** Colours for stdout. */
  c: Colors
  /** Colours for stderr. */
  ec: Colors
  string(name: string): string | undefined
  flag(name: string): boolean
  /** Writes a line to stdout. */
  print(line?: string): void
  /** Writes a line to stderr (status messages, warnings). */
  info(line?: string): void
}

export interface CommandSpec {
  name: string
  summary: string
  usage: string
  description?: string
  options: Record<string, OptionSpec>
  examples: string[]
  /** Resolves to the exit code (default 0). */
  run(ctx: CommandContext): Promise<number | undefined>
}

export const connectionOptions: Record<string, OptionSpec> = {
  url: {
    type: 'string',
    valueName: 'url',
    description: 'Base URL of the Halyard instance (env: HALYARD_URL)',
  },
  key: {
    type: 'string',
    valueName: 'key',
    description: 'Management key, or "-" to read it from stdin (env: HALYARD_API_KEY)',
  },
  profile: {
    type: 'string',
    valueName: 'name',
    description: 'Profile in the config file (default: "default", env: HALYARD_PROFILE)',
  },
}

export const commonOptions: Record<string, OptionSpec> = {
  'no-color': { type: 'boolean', description: 'Disable coloured output (also: NO_COLOR)' },
  help: { type: 'boolean', short: 'h', description: 'Show this help' },
}

export function createContext(spec: CommandSpec, argv: string[], rt: Runtime): CommandContext {
  const options = { ...spec.options, ...commonOptions }
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(
        Object.entries(options).map(([name, option]) => [
          name,
          option.short ? { type: option.type, short: option.short } : { type: option.type },
        ]),
      ),
    })
  } catch (error) {
    throw new UsageError(
      (error as Error).message.replace(/\.?\s*To specify.*$/s, '.'),
      `Run \`halyard ${spec.name} --help\` for usage.`,
    )
  }
  const values = parsed.values as Record<string, string | boolean | undefined>
  const noColor = values['no-color'] === true
  return {
    rt,
    positionals: parsed.positionals,
    c: createColors(shouldUseColor(rt.stdout, rt.env, noColor)),
    ec: createColors(shouldUseColor(rt.stderr, rt.env, noColor)),
    string: (name) => {
      const value = values[name]
      return typeof value === 'string' ? value : undefined
    },
    flag: (name) => values[name] === true,
    print: (line = '') => rt.stdout.write(`${line}\n`),
    info: (line = '') => rt.stderr.write(`${line}\n`),
  }
}

/** True when `--help` was passed (checked before positional validation). */
export function wantsHelp(argv: string[]): boolean {
  for (const arg of argv) {
    if (arg === '--') return false
    if (arg === '--help' || arg === '-h') return true
  }
  return false
}
