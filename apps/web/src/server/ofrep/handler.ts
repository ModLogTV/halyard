import { createHash } from 'node:crypto'
import {
  type EvaluationContext,
  type EvaluationDetails,
  type JsonValue,
  type OfrepReason,
  reasonToOfrep,
} from '@modlogtv/halyard-engine'
import { authenticateSdkKey } from '@/server/auth/api-key'
import { getRuleset } from '@/server/cache/ruleset-cache'
import { errorResponse, HttpError, unauthorized } from '@/server/errors'
import { evaluateForEnvironment } from '@/server/evaluation/evaluate'
import { type OfrepEndpoint, observeRequest } from '@/server/evaluation/metrics'

/**
 * OpenFeature Remote Evaluation Protocol (OFREP) v1 handlers, see
 * https://github.com/open-feature/protocol/blob/main/service/openapi.yaml.
 *
 * Every handler is a plain `Request → Response` function so it can be mounted by the
 * router and exercised directly in tests or through a real OpenFeature provider.
 */

/** Error codes OFREP allows in an evaluation failure. */
export type OfrepErrorCode = 'PARSE_ERROR' | 'TARGETING_KEY_MISSING' | 'INVALID_CONTEXT' | 'GENERAL'

export interface OfrepEvaluationSuccess {
  key: string
  value: JsonValue
  reason: OfrepReason
  variant?: string
  metadata?: Record<string, string | number | boolean>
}

export interface OfrepEvaluationFailure {
  key: string
  errorCode: OfrepErrorCode
  errorDetails?: string
}

/** Contexts larger than this are rejected before parsing. */
const MAX_BODY_CHARS = 256 * 1024

/** OFREP v1 `GET /ofrep/v1/configuration` polling floor advertised to providers. */
export const MIN_POLLING_INTERVAL_MS = 5_000

const CACHE_CONTROL = 'private, must-revalidate'
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag',
}

class RequestError extends Error {
  constructor(
    readonly errorCode: OfrepErrorCode,
    message: string,
  ) {
    super(message)
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...headers } })
}

function notModified(headers: Record<string, string>, cors = true): Response {
  return new Response(null, {
    status: 304,
    headers: cors ? { ...CORS_HEADERS, ...headers } : headers,
  })
}

const sha256 = (input: string) => createHash('sha256').update(input).digest('hex')

/** JSON with object keys sorted recursively, so equal contexts hash equally regardless of key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** `If-None-Match` check using the weak comparison of RFC 9110 §13.1.2. */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  const opaque = (tag: string) => (tag.startsWith('W/') ? tag.slice(2) : tag)
  const target = opaque(etag)
  return ifNoneMatch.split(',').some((candidate) => {
    const tag = candidate.trim()
    return tag === '*' || opaque(tag) === target
  })
}

/**
 * Bulk evaluation ETag: a strong tag combining the ruleset content tag and a hash of
 * the canonical evaluation context. The body is a deterministic function of both,
 * so equal tags always mean byte-identical responses, and a different context (or
 * any configuration change) yields a different tag.
 */
export function bulkEtag(rulesetEtag: string, context: EvaluationContext): string {
  const ruleset = rulesetEtag.replace(/^W\//, '').replaceAll('"', '')
  return `"${ruleset}.${sha256(canonicalJson(context)).slice(0, 32)}"`
}

/** Reads `{ context }` from the request body. An empty body means an empty context. */
async function readContext(request: Request): Promise<EvaluationContext> {
  const text = await request.text()
  if (text.length > MAX_BODY_CHARS) {
    throw new RequestError('INVALID_CONTEXT', 'Request body exceeds 256 KiB')
  }
  if (text.trim() === '') return {}
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new RequestError('PARSE_ERROR', 'Request body is not valid JSON')
  }
  if (!isObject(body)) {
    throw new RequestError(
      'INVALID_CONTEXT',
      'Request body must be a JSON object with a "context" property',
    )
  }
  const { context } = body
  if (context === undefined) return {}
  if (!isObject(context))
    throw new RequestError('INVALID_CONTEXT', '"context" must be a JSON object')
  if (context.targetingKey !== undefined && typeof context.targetingKey !== 'string') {
    throw new RequestError('INVALID_CONTEXT', '"context.targetingKey" must be a string')
  }
  return context as EvaluationContext
}

function toOfrepErrorCode(details: EvaluationDetails): OfrepErrorCode {
  switch (details.errorCode) {
    case 'TARGETING_KEY_MISSING':
    case 'PARSE_ERROR':
    case 'INVALID_CONTEXT':
      return details.errorCode
    default:
      // TYPE_MISMATCH and GENERAL are configuration problems; OFREP reports them as GENERAL.
      return 'GENERAL'
  }
}

function toSuccess(details: EvaluationDetails): OfrepEvaluationSuccess {
  const result: OfrepEvaluationSuccess = {
    key: details.flagKey,
    value: details.value,
    reason: reasonToOfrep(details.reason),
    variant: details.variant,
  }
  if (details.ruleId !== undefined || details.experimentKey !== undefined) {
    const metadata: Record<string, string> = {}
    if (details.ruleId !== undefined) metadata.ruleId = details.ruleId
    if (details.experimentKey !== undefined) metadata.experimentKey = details.experimentKey
    result.metadata = metadata
  }
  return result
}

function toFailure(details: EvaluationDetails): OfrepEvaluationFailure {
  return {
    key: details.flagKey,
    errorCode: toOfrepErrorCode(details),
    errorDetails: details.errorMessage,
  }
}

/**
 * Runs a handler body and turns thrown errors into OFREP error responses: request
 * errors → 400, authentication errors → 401, anything unexpected → 500. Records the
 * request duration.
 */
async function respond(
  endpoint: OfrepEndpoint,
  flagKey: string | undefined,
  run: () => Promise<Response>,
): Promise<Response> {
  const started = performance.now()
  let response: Response
  try {
    response = await run()
  } catch (error) {
    if (error instanceof RequestError) {
      const body = { errorCode: error.errorCode, errorDetails: error.message }
      response = json(flagKey === undefined ? body : { key: flagKey, ...body }, 400)
    } else if (error instanceof HttpError) {
      response = json({ errorCode: 'GENERAL', errorDetails: error.message }, error.status)
    } else {
      console.error(`OFREP ${endpoint} request failed`, error)
      response = json({ errorDetails: 'Internal server error' }, 500)
    }
  }
  observeRequest(endpoint, response.status, (performance.now() - started) / 1000)
  return response
}

const missingEnvironment = () => unauthorized('The environment of this SDK key no longer exists')

/** `POST /ofrep/v1/evaluate/flags/{key}`: evaluates one flag. */
export function handleSingleEvaluation(request: Request, flagKey: string): Promise<Response> {
  return respond('single', flagKey, async () => {
    const principal = await authenticateSdkKey(request)
    const context = await readContext(request)
    const evaluation = await evaluateForEnvironment({
      environmentId: principal.environmentId,
      projectId: principal.projectId,
      flagKey,
      context,
    })
    if (!evaluation) throw missingEnvironment()
    const [details] = evaluation.results
    if (!details) throw new Error('Evaluation returned no result')
    if (details.reason !== 'ERROR') return json(toSuccess(details), 200)
    if (details.errorCode === 'FLAG_NOT_FOUND') {
      return json(
        { key: flagKey, errorCode: 'FLAG_NOT_FOUND', errorDetails: details.errorMessage },
        404,
      )
    }
    return json(toFailure(details), 400)
  })
}

/**
 * `POST /ofrep/v1/evaluate/flags`: evaluates every non-archived flag of the key's
 * environment. Supports `If-None-Match` → 304, see {@link bulkEtag}.
 *
 * Flags are evaluated (and tracked) even when the answer is 304: clients that poll
 * with an ETag keep using the flags, and evaluation stats drive stale-flag detection.
 */
export function handleBulkEvaluation(request: Request): Promise<Response> {
  return respond('bulk', undefined, async () => {
    const principal = await authenticateSdkKey(request)
    const context = await readContext(request)
    const evaluation = await evaluateForEnvironment({
      environmentId: principal.environmentId,
      projectId: principal.projectId,
      context,
    })
    if (!evaluation) throw missingEnvironment()
    const headers = {
      ETag: bulkEtag(evaluation.cached.etag, context),
      'Cache-Control': CACHE_CONTROL,
    }
    if (etagMatches(request.headers.get('if-none-match'), headers.ETag)) return notModified(headers)
    const flags = evaluation.results.map((details) =>
      details.reason === 'ERROR' ? toFailure(details) : toSuccess(details),
    )
    return json({ flags }, 200, headers)
  })
}

/**
 * Body of `GET /ofrep/v1/configuration`. The endpoint was part of OFREP until
 * protocol PR #38 (May 2025) removed it; current providers no longer call it. It is
 * served for older providers using the last published schema.
 */
export const OFREP_CONFIGURATION = {
  name: 'Halyard',
  capabilities: {
    cacheInvalidation: {
      polling: { enabled: true, minPollingIntervalMs: MIN_POLLING_INTERVAL_MS },
    },
    flagEvaluation: { supportedTypes: ['boolean', 'string', 'int', 'float', 'object'] },
  },
} as const

const CONFIGURATION_ETAG = `"${sha256(JSON.stringify(OFREP_CONFIGURATION)).slice(0, 32)}"`

/** `GET /ofrep/v1/configuration` (legacy OFREP extension). */
export function handleConfiguration(request: Request): Promise<Response> {
  return respond('configuration', undefined, async () => {
    await authenticateSdkKey(request)
    const headers = { ETag: CONFIGURATION_ETAG, 'Cache-Control': CACHE_CONTROL }
    if (etagMatches(request.headers.get('if-none-match'), CONFIGURATION_ETAG)) {
      return notModified(headers)
    }
    return json(OFREP_CONFIGURATION, 200, headers)
  })
}

/**
 * `GET /api/v1/ruleset`: the environment's full ruleset for local evaluation with
 * `@modlogtv/halyard-engine`. The ETag is the ruleset content tag, marked weak because the
 * body's `generatedAt` differs between cache loads.
 *
 * Deliberately sent without CORS headers: the ruleset exposes every rule and segment
 * condition, so browsers should use the bulk OFREP endpoint instead.
 */
export async function handleRuleset(request: Request): Promise<Response> {
  const started = performance.now()
  let response: Response
  try {
    const principal = await authenticateSdkKey(request)
    const cached = await getRuleset(principal.environmentId)
    if (!cached || cached.projectId !== principal.projectId) throw missingEnvironment()
    const headers = { ETag: `W/${cached.etag}`, 'Cache-Control': CACHE_CONTROL }
    response = etagMatches(request.headers.get('if-none-match'), headers.ETag)
      ? notModified(headers, false)
      : Response.json(cached.ruleset, { headers })
  } catch (error) {
    response = errorResponse(error)
  }
  observeRequest('ruleset', response.status, (performance.now() - started) / 1000)
  return response
}

/** Answers a CORS preflight for the OFREP endpoints. */
export function ofrepPreflight(methods = 'POST, OPTIONS'): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, X-API-Key',
      'Access-Control-Expose-Headers': 'ETag',
      'Access-Control-Max-Age': '86400',
    },
  })
}
