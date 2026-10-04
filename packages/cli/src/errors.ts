/** Process exit codes of the CLI. */
export const ExitCode = {
  Ok: 0,
  /** Invalid input, validation errors reported by the server, usage errors. */
  Validation: 1,
  /** Missing configuration or rejected credentials. */
  Config: 2,
  /** The server could not be reached (or is failing). */
  Network: 3,
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]

/** An error with a message that is safe to show to the user as is. */
export class CliError extends Error {
  readonly exitCode: ExitCodeValue
  readonly hint?: string

  constructor(message: string, exitCode: ExitCodeValue = ExitCode.Validation, hint?: string) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
    this.hint = hint
  }
}

/** Raised when a command is invoked incorrectly. */
export class UsageError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.Validation, hint)
    this.name = 'UsageError'
  }
}
