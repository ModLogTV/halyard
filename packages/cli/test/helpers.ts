import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { FetchLike } from '../src/api.js'
import type { Runtime } from '../src/runtime.js'

const tempDirs: string[] = []

export function makeTempDir(prefix = 'halyard-cli-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** Register once per test file to delete the directories created with `makeTempDir`. */
export function cleanupTempDirs(): void {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
}

export interface RecordedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

export type Route = (request: RecordedRequest) => Response | Promise<Response> | undefined

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A fetch fake that records requests and answers through `route`. */
export function fakeFetch(route: Route): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetch: FetchLike = async (input, init) => {
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url: input,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    requests.push(request)
    return (
      (await route(request)) ??
      json({ error: 'not_found', message: `no route for ${request.url}` }, 404)
    )
  }
  return { fetch, requests }
}

export interface TestRuntimeOptions {
  fetch?: FetchLike
  env?: Record<string, string | undefined>
  /** Text available on stdin; makes stdin a non-TTY pipe. */
  stdin?: string
  interactive?: boolean
  /** Answers handed out to `prompt()` in order. */
  answers?: string[]
  configHome?: string
  cwd?: string
  colorTty?: boolean
}

export function createTestRuntime(options: TestRuntimeOptions = {}) {
  const out: string[] = []
  const err: string[] = []
  const prompts: { question: string; secret: boolean }[] = []
  const answers = [...(options.answers ?? [])]
  const configHome = options.configHome ?? makeTempDir('halyard-config-')
  const rt: Runtime = {
    version: '1.2.3-test',
    stdout: { write: (text) => void out.push(text), isTTY: options.colorTty ?? false },
    stderr: { write: (text) => void err.push(text), isTTY: options.colorTty ?? false },
    stdin: {
      isTTY: options.interactive ?? false,
      readAll: async () => options.stdin ?? '',
    },
    env: { XDG_CONFIG_HOME: configHome, ...options.env },
    platform: 'linux',
    homedir: '/nonexistent-home',
    cwd: options.cwd ?? process.cwd(),
    fetch:
      options.fetch ??
      (async () => {
        throw new Error('unexpected network access')
      }),
    prompt: async (question, promptOptions) => {
      prompts.push({ question, secret: !!promptOptions?.secret })
      const answer = answers.shift()
      if (answer === undefined) throw new Error(`unexpected prompt: ${question}`)
      return answer
    },
  }
  return {
    rt,
    configHome,
    prompts,
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  }
}
