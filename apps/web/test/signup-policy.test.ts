import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { invitation, user } from '@/db/schema'
import { auth } from '@/lib/auth'
import { decideSignup, evaluateSignup, getSignupPolicy } from '@/server/auth/signup-policy'
import { createProjectFixture } from './factories'
import { createTestUser, resetDatabase } from './helpers'

beforeEach(async () => {
  await resetDatabase()
})

describe('decideSignup', () => {
  it('always lets the very first user in and marks them as first', () => {
    expect(decideSignup({ mode: 'invite', userCount: 0, hasInvitation: false })).toEqual({
      allowed: true,
      firstUser: true,
    })
    expect(decideSignup({ mode: 'open', userCount: 0, hasInvitation: false })).toEqual({
      allowed: true,
      firstUser: true,
    })
  })

  it('lets everybody in when sign-up is open', () => {
    expect(decideSignup({ mode: 'open', userCount: 5, hasInvitation: false })).toEqual({
      allowed: true,
      firstUser: false,
    })
  })

  it('requires an invitation once users exist in invite mode', () => {
    expect(decideSignup({ mode: 'invite', userCount: 1, hasInvitation: false })).toEqual({
      allowed: false,
      reason: 'invite_only',
    })
    expect(decideSignup({ mode: 'invite', userCount: 1, hasInvitation: true })).toEqual({
      allowed: true,
      firstUser: false,
    })
  })
})

describe('evaluateSignup (database)', () => {
  it('allows the first user on an empty instance', async () => {
    expect(await evaluateSignup('first@example.com', 'invite')).toEqual({
      allowed: true,
      firstUser: true,
    })
  })

  it('denies uninvited users in invite mode once an account exists', async () => {
    await createTestUser()
    expect(await evaluateSignup('stranger@example.com', 'invite')).toEqual({
      allowed: false,
      reason: 'invite_only',
    })
    expect(await evaluateSignup('stranger@example.com', 'open')).toEqual({
      allowed: true,
      firstUser: false,
    })
  })

  it('allows an email with a pending invitation, ignoring case', async () => {
    const fx = await createProjectFixture()
    await auth.api.createInvitation({
      headers: fx.owner.user.headers,
      body: { organizationId: fx.projectId, email: 'Invited@Example.com', role: 'editor' },
    })
    expect(await evaluateSignup('invited@example.com', 'invite')).toEqual({
      allowed: true,
      firstUser: false,
    })
  })

  it('ignores expired, accepted and cancelled invitations', async () => {
    const fx = await createProjectFixture()
    const invite = async (email: string) =>
      auth.api.createInvitation({
        headers: fx.owner.user.headers,
        body: { organizationId: fx.projectId, email, role: 'viewer' },
      })
    const expired = await invite('expired@example.com')
    await db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invitation.id, expired.id))
    const cancelled = await invite('cancelled@example.com')
    await db.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, cancelled.id))

    expect(await evaluateSignup('expired@example.com', 'invite')).toMatchObject({ allowed: false })
    expect(await evaluateSignup('cancelled@example.com', 'invite')).toMatchObject({
      allowed: false,
    })
  })
})

describe('sign-up through better-auth', () => {
  it('makes the first account an instance admin and later accounts regular users', async () => {
    const first = await createTestUser()
    const second = await createTestUser()
    const roles = Object.fromEntries(
      (await db.select({ id: user.id, role: user.role }).from(user)).map((u) => [u.id, u.role]),
    )
    expect(roles[first.id]).toBe('admin')
    expect(roles[second.id]).toBe('user')
  })
})

describe('getSignupPolicy', () => {
  it('reports bootstrap while no account exists', async () => {
    expect(await getSignupPolicy('invite')).toEqual({ mode: 'invite', bootstrap: true })
    await createTestUser()
    expect(await getSignupPolicy('invite')).toEqual({ mode: 'invite', bootstrap: false })
    expect(await getSignupPolicy('open')).toEqual({ mode: 'open', bootstrap: false })
  })
})
