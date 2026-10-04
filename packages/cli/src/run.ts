import { createColors, shouldUseColor } from './colors.js'
import { type CommandSpec, createContext, wantsHelp } from './command.js'
import { commands } from './commands/index.js'
import { CliError, ExitCode } from './errors.js'
import { commandHelp, rootHelp } from './help.js'
import type { Runtime } from './runtime.js'

function find(name: string): CommandSpec | undefined {
  return commands.find((command) => command.name === name)
}

function reportError(rt: Runtime, error: unknown): number {
  const c = createColors(shouldUseColor(rt.stderr, rt.env))
  if (error instanceof CliError) {
    rt.stderr.write(`${c.red('error:')} ${error.message}\n`)
    if (error.hint) rt.stderr.write(`${c.dim(error.hint)}\n`)
    return error.exitCode
  }
  const debug = !!rt.env.HALYARD_DEBUG
  const message =
    error instanceof Error ? (debug && error.stack ? error.stack : error.message) : String(error)
  rt.stderr.write(`${c.red('error:')} Unexpected error: ${message}\n`)
  if (!debug) rt.stderr.write(`${c.dim('Set HALYARD_DEBUG=1 for a stack trace.')}\n`)
  return ExitCode.Validation
}

/** Runs the CLI in-process and resolves to the exit code. Never throws. */
export async function run(argv: string[], rt: Runtime): Promise<number> {
  try {
    const [first, ...rest] = argv
    if (first === undefined || first === '-h' || first === '--help') {
      rt.stdout.write(rootHelp(commands, rt.version))
      return ExitCode.Ok
    }
    if (first === '-V' || first === '--version') {
      rt.stdout.write(`${rt.version}\n`)
      return ExitCode.Ok
    }
    if (first === 'help') {
      const target = rest[0] ? find(rest[0]) : undefined
      if (rest[0] && !target)
        throw new CliError(
          `Unknown command "${rest[0]}".`,
          ExitCode.Validation,
          'Run `halyard --help` for the list of commands.',
        )
      rt.stdout.write(target ? commandHelp(target) : rootHelp(commands, rt.version))
      return ExitCode.Ok
    }
    const command = find(first)
    if (!command) {
      throw new CliError(
        `Unknown command "${first}".`,
        ExitCode.Validation,
        'Run `halyard --help` for the list of commands.',
      )
    }
    if (wantsHelp(rest)) {
      rt.stdout.write(commandHelp(command))
      return ExitCode.Ok
    }
    const ctx = createContext(command, rest, rt)
    return (await command.run(ctx)) ?? ExitCode.Ok
  } catch (error) {
    return reportError(rt, error)
  }
}
