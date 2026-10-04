import { isDeepStrictEqual } from 'node:util'
import { isAPIError } from 'better-auth/api'
import type { z } from 'zod'
import { badRequest, HttpError } from '@/server/errors'

/** Parses service input with a zod schema, turning validation failures into a 400. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const message = result.error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ')
  throw badRequest(message)
}

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** The first row of a result that must not be empty (inserts and updates with `returning`). */
export function one<T>(rows: T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('Expected the query to return a row')
  return row
}

export const jsonEqual = (a: unknown, b: unknown): boolean => isDeepStrictEqual(a, b)

const AUTH_CONFLICT_CODES = new Set([
  'ORGANIZATION_ALREADY_EXISTS',
  'ORGANIZATION_SLUG_ALREADY_TAKEN',
])

/** Translates a better-auth `APIError` into the HTTP errors used by the rest of the server. */
export function translateAuthError(error: unknown): unknown {
  if (error instanceof HttpError) return error
  if (!isAPIError(error)) return error
  const body = (error.body ?? {}) as { code?: string; message?: string }
  const code = body.code ?? 'BAD_REQUEST'
  const message = body.message ?? error.message ?? 'Request failed'
  if (AUTH_CONFLICT_CODES.has(code)) return new HttpError(409, 'CONFLICT', message)
  const status = error.statusCode
  if (status === 401) return new HttpError(401, 'UNAUTHORIZED', message)
  if (status === 403) return new HttpError(403, 'FORBIDDEN', message)
  if (status === 404) return new HttpError(404, 'NOT_FOUND', message)
  if (status === 409) return new HttpError(409, 'CONFLICT', message)
  if (status >= 500) return error
  return new HttpError(400, 'BAD_REQUEST', message)
}

/** Runs a better-auth call and rethrows its failures as `HttpError`. */
export async function authCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw translateAuthError(error)
  }
}
