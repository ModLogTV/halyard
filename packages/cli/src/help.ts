import { type CommandSpec, commonOptions } from './command.js'

const DESCRIPTION =
  'Command line interface for Halyard: generate TypeScript types from your flags, import and export projects.'

const EXIT_CODES = [
  '0  success',
  '1  validation errors or invalid usage',
  '2  configuration or authentication error (no login, invalid or read-only key)',
  '3  network error (connection refused, timeout, server unavailable)',
]

function optionLine(name: string, spec: CommandSpec['options'][string]): [string, string] {
  const short = spec.short ? `-${spec.short}, ` : '    '
  const value = spec.type === 'string' ? ` <${spec.valueName ?? 'value'}>` : ''
  return [`${short}--${name}${value}`, spec.description]
}

function table(rows: [string, string][], indent = '  '): string[] {
  const width = Math.max(...rows.map(([left]) => left.length))
  return rows.map(([left, right]) => `${indent}${left.padEnd(width)}  ${right}`)
}

export function rootHelp(commands: CommandSpec[], version: string): string {
  return [
    `halyard ${version}`,
    DESCRIPTION,
    '',
    'Usage: halyard <command> [options]',
    '',
    'Commands:',
    ...table(commands.map((command) => [command.name, command.summary])),
    '',
    'Options:',
    ...table([
      ['-h, --help', 'Show help (also: halyard <command> --help)'],
      ['-V, --version', 'Print the version'],
    ]),
    '',
    'Credentials are resolved from --url/--key, then HALYARD_URL / HALYARD_API_KEY,',
    'then the profile stored by `halyard login`.',
    '',
    'Examples:',
    '  halyard login --url https://flags.example.com',
    '  halyard types --out src/flags.generated.ts',
    '  halyard export --out halyard.json',
    '  halyard import halyard.json --dry-run',
    '',
    'Exit codes:',
    ...EXIT_CODES.map((line) => `  ${line}`),
    '',
  ].join('\n')
}

export function commandHelp(command: CommandSpec): string {
  const options = { ...command.options, ...commonOptions }
  return [
    `Usage: ${command.usage}`,
    '',
    command.description ?? command.summary,
    '',
    'Options:',
    ...table(Object.entries(options).map(([name, spec]) => optionLine(name, spec))),
    '',
    'Examples:',
    ...command.examples.map((example) => `  ${example}`),
    '',
  ].join('\n')
}
