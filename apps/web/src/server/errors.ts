/** Error carrying an HTTP status. Server functions and API routes translate it into a response. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }

  toResponse(): Response {
    return Response.json({ error: this.code, message: this.message }, { status: this.status })
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'UNAUTHORIZED', message)
export const forbidden = (message = 'You do not have permission to do this') =>
  new HttpError(403, 'FORBIDDEN', message)
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`)
export const badRequest = (message: string) => new HttpError(400, 'BAD_REQUEST', message)
export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message)

/** Converts any thrown value into a Response, hiding internals for unexpected errors. */
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return error.toResponse()
  console.error(error)
  return Response.json({ error: 'INTERNAL', message: 'Internal server error' }, { status: 500 })
}
