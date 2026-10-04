import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { requireUser } from '@/server/auth/session'
import { badRequest, forbidden } from '@/server/errors'

/** Instance admin functions wrap the better-auth admin plugin. Every call re-checks `isAdmin`. */
async function requireAdmin() {
  const actor = await requireUser()
  if (!actor.isAdmin) throw forbidden('Instance admin access required')
  return actor
}

const userIdSchema = z.object({ userId: z.string().min(1) })

export const listUsers = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      search: z.string().trim().max(200).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const result = await auth.api.listUsers({
      headers: getRequestHeaders(),
      query: {
        searchValue: data.search || undefined,
        searchField: 'email',
        searchOperator: 'contains',
        limit: data.limit ?? 50,
        offset: data.offset ?? 0,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      },
    })
    return {
      total: result.total,
      users: result.users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role ?? 'user',
        banned: Boolean(user.banned),
        banReason: user.banReason ?? null,
        createdAt: new Date(user.createdAt).toISOString(),
      })),
    }
  })

export type AdminUser = Awaited<ReturnType<typeof listUsers>>['users'][number]

export const setUserRole = createServerFn({ method: 'POST' })
  .validator(userIdSchema.extend({ role: z.enum(['admin', 'user']) }))
  .handler(async ({ data }) => {
    const actor = await requireAdmin()
    if (data.userId === actor.userId && data.role !== 'admin') {
      throw badRequest('You cannot remove your own admin role')
    }
    await auth.api.setRole({
      headers: getRequestHeaders(),
      body: { userId: data.userId, role: data.role },
    })
    return { ok: true as const }
  })

export const banUser = createServerFn({ method: 'POST' })
  .validator(userIdSchema.extend({ reason: z.string().trim().max(500).optional() }))
  .handler(async ({ data }) => {
    const actor = await requireAdmin()
    if (data.userId === actor.userId) throw badRequest('You cannot ban yourself')
    await auth.api.banUser({
      headers: getRequestHeaders(),
      body: { userId: data.userId, banReason: data.reason || undefined },
    })
    return { ok: true as const }
  })

export const unbanUser = createServerFn({ method: 'POST' })
  .validator(userIdSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    await auth.api.unbanUser({ headers: getRequestHeaders(), body: { userId: data.userId } })
    return { ok: true as const }
  })

export const removeUser = createServerFn({ method: 'POST' })
  .validator(userIdSchema)
  .handler(async ({ data }) => {
    const actor = await requireAdmin()
    if (data.userId === actor.userId) throw badRequest('You cannot delete your own account')
    await auth.api.removeUser({ headers: getRequestHeaders(), body: { userId: data.userId } })
    return { ok: true as const }
  })
