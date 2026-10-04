import { authenticateSdkKey } from '@/server/auth/api-key'
import { badRequest, errorResponse } from '@/server/errors'
import { trackBodySchema } from '@/server/schemas/experiments'
import { recordConversionBatch } from '@/server/services/experiments'
import { parseInput } from '@/server/services/util'

/** Request bodies larger than this are rejected before parsing. */
const MAX_BODY_CHARS = 256 * 1024

const CORS_HEADERS: Record<string, string> = { 'Access-Control-Allow-Origin': '*' }

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value)
  return new Response(response.body, { status: response.status, headers })
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > MAX_BODY_CHARS) throw badRequest('Request body exceeds 256 KiB')
  if (text.trim() === '') throw badRequest('Request body is empty')
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest('Request body is not valid JSON')
  }
}

/**
 * `POST /api/v1/track`: records conversion events for experiments in the SDK key's
 * environment. The body is one event `{ event, targetingKey, value?, timestamp? }` or
 * an array of up to 100. Answers 202 `{ accepted, matched }`; 400 on an invalid body,
 * 401 on a missing or invalid key. Sent with CORS headers so browsers can post.
 */
export async function handleTrack(request: Request): Promise<Response> {
  try {
    const principal = await authenticateSdkKey(request)
    const body = parseInput(trackBodySchema, await readBody(request))
    const events = Array.isArray(body) ? body : [body]
    const { matched } = await recordConversionBatch({
      projectId: principal.projectId,
      environmentId: principal.environmentId,
      events: events.map((e) => ({
        event: e.event,
        targetingKey: e.targetingKey,
        occurredAt: e.timestamp === undefined ? undefined : new Date(e.timestamp),
      })),
    })
    return Response.json(
      { accepted: events.length, matched },
      { status: 202, headers: CORS_HEADERS },
    )
  } catch (error) {
    return withCors(errorResponse(error))
  }
}

/** Answers a CORS preflight for the tracking endpoint. */
export function trackPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  })
}
