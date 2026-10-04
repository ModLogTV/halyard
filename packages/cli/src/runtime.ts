import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'
import type { FetchLike } from './api.js'
import { CliError } from './errors.js'

export interface OutputStream {
  write(text: string): void
  isTTY: boolean
}

/** Everything the commands need from the outside world; faked in tests. */
export interface Runtime {
  version: string
  stdout: OutputStream
  stderr: OutputStream
  stdin: { isTTY: boolean; readAll(): Promise<string> }
  env: Record<string, string | undefined>
  platform: string
  homedir: string
  cwd: string
  fetch: FetchLike
  /** Asks a question on the terminal (prompts go to stderr so stdout stays pipeable). */
  prompt(question: string, options?: { secret?: boolean }): Promise<string>
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function readSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new CliError('Cannot prompt for a secret without a terminal.'))
      return
    }
    process.stderr.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stderr.write('\n')
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish()
          resolve(value)
          return
        }
        if (char === '\u0003') {
          finish()
          reject(new CliError('Aborted.'))
          return
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else if (char >= ' ') value += char
      }
    }
    stdin.on('data', onData)
  })
}

async function readLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

export function createNodeRuntime(version: string): Runtime {
  return {
    version,
    stdout: { write: (text) => void process.stdout.write(text), isTTY: !!process.stdout.isTTY },
    stderr: { write: (text) => void process.stderr.write(text), isTTY: !!process.stderr.isTTY },
    stdin: { isTTY: !!process.stdin.isTTY, readAll: readAllStdin },
    env: process.env,
    platform: process.platform,
    homedir: homedir(),
    cwd: process.cwd(),
    fetch: (input, init) => fetch(input, init),
    prompt: (question, options) => (options?.secret ? readSecret(question) : readLine(question)),
  }
}
