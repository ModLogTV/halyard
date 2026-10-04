import { badRequest, HttpError } from '@/server/errors'

/** Request bodies larger than this are rejected (a whole project export is a few hundred KB). */
export const MAX_BODY_BYTES = 10 * 1024 * 1024

/** Reads a JSON object from the request body, with a size limit. Throws 400 or 413. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large')
  }
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw badRequest('The request body must be valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest('The request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}
