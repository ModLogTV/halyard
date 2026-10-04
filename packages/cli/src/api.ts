import type { FlagEnvironmentConfig, FlagType, JsonValue, Variant } from '@modlogtv/halyard-engine'
import { CliError, ExitCode } from './errors.js'

// ---------------------------------------------------------------------------
// Response types of the Halyard REST API (`/api/v1`).
// ---------------------------------------------------------------------------

export interface EnvironmentInfo {
  id: string
  key: string
  name: string
  color: string
  isProduction: boolean
}

export interface ProjectInfo {
  id: string
  name: string
  slug: string
  description: string | null
  environments: EnvironmentInfo[]
}

export interface FlagSummary {
  key: string
  name: string
  description: string | null
  type: FlagType
  variants: Pick<Variant, 'key' | 'value' | 'name'>[]
  tags: string[]
  archived: boolean
}

export interface ExportDocument {
  version: 1
  exportedAt: string
  project: { slug: string; name: string; description: string | null }
  environments: {
    key: string
    name: string
    color: string
    isProduction: boolean
    sortOrder: number
  }[]
  segments: {
    key: string
    name: string
    description: string | null
    match: 'all' | 'any'
    conditions: JsonValue[]
  }[]
  flags: (Omit<FlagSummary, 'variants'> & {
    variants: Variant[]
    environments: Record<string, FlagEnvironmentConfig>
  })[]
}

export interface FlagdExport {
  flagd: Record<string, unknown>
  warnings: string[]
}

export interface DiffChange {
  field: string
  before: unknown
  after: unknown
}

export interface DiffUpdate {
  key: string
  changes: DiffChange[]
  /** Only present on flags: changes per environment key. */
  environments?: Record<string, { changes: DiffChange[] }>
}

export interface DiffSection {
  create: ({ key: string } & Record<string, unknown>)[]
  update: DiffUpdate[]
  delete: { key: string }[]
  unchanged: number
}

export interface ImportDiff {
  environments: DiffSection
  segments: DiffSection
  flags: DiffSection
}

export interface ImportResult {
  diff: ImportDiff
  errors: string[]
  warnings: string[]
  applied: boolean
}

export interface ImportRequest {
  document: unknown
  prune?: boolean
  dryRun?: boolean
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ClientOptions {
  /** Base URL of the Halyard instance, without a trailing slash. */
  url: string
  /** Management key (`hal_mgmt_…`). */
  key: string
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: FetchLike
  /** Per-request timeout. Defaults to 30 seconds. */
  timeoutMs?: number
  userAgent?: string
}

export const DEFAULT_TIMEOUT_MS = 30_000

export interface HalyardClient {
  currentProject(): Promise<ProjectInfo>
  listFlags(): Promise<FlagSummary[]>
  exportDocument(): Promise<ExportDocument>
  exportFlagd(environment: string): Promise<FlagdExport>
  importDocument(request: ImportRequest): Promise<ImportResult>
}

const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

function errorCodeOf(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    if (typeof current === 'object') {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string') return code
      const errors = (current as { errors?: unknown }).errors
      if (Array.isArray(errors)) {
        for (const inner of errors) {
          const innerCode = errorCodeOf(inner)
          if (innerCode) return innerCode
        }
      }
      current = (current as { cause?: unknown }).cause
    } else {
      break
    }
  }
  return undefined
}

/** Turns a failed `fetch` into a `CliError` with a message that tells the user what to do. */
export function networkError(error: unknown, url: string, timeoutMs: number): CliError {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new CliError(
      `The request to ${url} timed out after ${Math.round(timeoutMs / 1000)}s.`,
      ExitCode.Network,
      'Check that the instance is reachable and --url (or HALYARD_URL) is correct.',
    )
  }
  const code = errorCodeOf(error)
  if (code === 'ECONNREFUSED' || code === 'ConnectionRefused') {
    return new CliError(
      `Could not connect to ${url}: connection refused.`,
      ExitCode.Network,
      'Is the instance running? Check --url (or HALYARD_URL).',
    )
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'DNSResolutionFailed') {
    return new CliError(
      `Could not resolve the host of ${url}.`,
      ExitCode.Network,
      'Check the spelling of --url (or HALYARD_URL) and your network connection.',
    )
  }
  if (code && TLS_ERROR_CODES.has(code)) {
    return new CliError(
      `Could not verify the TLS certificate of ${url} (${code}).`,
      ExitCode.Network,
      'For a private CA, set NODE_EXTRA_CA_CERTS to the CA bundle.',
    )
  }
  const detail = error instanceof Error ? error.message : String(error)
  return new CliError(
    `Could not reach ${url}: ${detail}`,
    ExitCode.Network,
    'Check --url (or HALYARD_URL) and your network connection.',
  )
}

interface ErrorBody {
  error?: string
  message?: string
}

function parseJson(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Maps an HTTP error response to a `CliError`. Exported for tests. */
export function errorFromResponse(
  status: number,
  body: unknown,
  context: { method: string; path: string; url: string },
): CliError {
  const parsed = (body && typeof body === 'object' ? body : {}) as ErrorBody
  const serverMessage = typeof parsed.message === 'string' ? parsed.message : undefined
  const isApiError = typeof parsed.error === 'string'

  if (status === 401) {
    return new CliError(
      'Invalid management key.',
      ExitCode.Config,
      'Check --key / HALYARD_API_KEY, or run `halyard login` again. Keys start with hal_mgmt_.',
    )
  }
  if (status === 403) {
    if (context.method !== 'GET') {
      return new CliError(
        'This key cannot write; create a key with write access in Settings → API keys.',
        ExitCode.Config,
      )
    }
    return new CliError(
      serverMessage ?? 'This key is not allowed to access this resource.',
      ExitCode.Config,
    )
  }
  if (status === 404 && !isApiError) {
    return new CliError(
      `${context.url} does not serve the Halyard REST API (404 for ${context.path}).`,
      ExitCode.Config,
      'Check --url (or HALYARD_URL): it must be the base URL of your Halyard instance.',
    )
  }
  if (status >= 500) {
    return new CliError(
      `The server failed to handle the request (${status}${serverMessage ? `: ${serverMessage}` : ''}).`,
      ExitCode.Network,
    )
  }
  return new CliError(
    serverMessage ?? `The server answered with HTTP ${status}.`,
    ExitCode.Validation,
  )
}

export function createClient(options: ClientOptions): HalyardClient {
  const baseUrl = options.url.replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    init: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const query = init.query ? `?${new URLSearchParams(init.query).toString()}` : ''
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.key}`,
      accept: 'application/json',
    }
    if (options.userAgent) headers['user-agent'] = options.userAgent
    if (init.body !== undefined) headers['content-type'] = 'application/json'

    let response: Response
    let text: string
    try {
      response = await doFetch(`${baseUrl}${path}${query}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      text = await response.text()
    } catch (error) {
      throw networkError(error, baseUrl, timeoutMs)
    }

    const body = parseJson(text)
    if (!response.ok) {
      throw errorFromResponse(response.status, body, { method, path, url: baseUrl })
    }
    if (body === undefined || body === null || typeof body !== 'object') {
      throw new CliError(
        `Unexpected response from ${baseUrl}${path}: expected JSON.`,
        ExitCode.Config,
        'Check --url (or HALYARD_URL): it must be the base URL of your Halyard instance.',
      )
    }
    return body as T
  }

  return {
    currentProject: () => request<ProjectInfo>('GET', '/api/v1/projects/current'),
    async listFlags() {
      const result = await request<{ flags?: FlagSummary[] }>('GET', '/api/v1/flags')
      if (!Array.isArray(result.flags)) {
        throw new CliError('Unexpected response from /api/v1/flags: missing "flags".')
      }
      return result.flags
    },
    exportDocument: () => request<ExportDocument>('GET', '/api/v1/export'),
    exportFlagd: (environment) =>
      request<FlagdExport>('GET', '/api/v1/export/flagd', { query: { environment } }),
    importDocument: (body) => request<ImportResult>('POST', '/api/v1/import', { body }),
  }
}
