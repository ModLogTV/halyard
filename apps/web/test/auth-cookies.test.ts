import { beforeEach, describe, expect, it } from 'vitest'
import { auth } from '@/lib/auth'
import { createTestUser, resetDatabase } from './helpers'

beforeEach(async () => {
  await resetDatabase()
})

describe('session cookies', () => {
  it('survive a default-named better-auth cookie from a parent domain', async () => {
    const { id, headers } = await createTestUser()
    // What a browser sends when another better-auth app on the parent domain set its
    // session cookie for every subdomain earlier: the foreign cookie comes first.
    const foreign = 'better-auth.session_token=foreign.c2lnbmF0dXJlLWZyb20tYW5vdGhlci1hcHA='
    const cookie = `${foreign}; ${headers.get('cookie')}`

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) })

    expect(session?.user.id).toBe(id)
  })
})
