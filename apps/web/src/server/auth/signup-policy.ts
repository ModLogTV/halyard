import { and, count, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { invitation, user } from '@/db/schema'

/**
 * Who may create an account on this instance.
 *
 * - `invite`: the first account is always allowed (and becomes the instance admin);
 *   afterwards only email addresses with a pending project invitation may sign up.
 *   Instance admins can always create users from the admin page.
 * - `open`: anybody can sign up.
 */
export type SignupMode = 'open' | 'invite'

export type SignupDecision =
  | { allowed: true; firstUser: boolean }
  | { allowed: false; reason: 'invite_only' }

export interface SignupPolicy {
  mode: SignupMode
  /** True while the instance has no account yet: the next sign-up becomes admin. */
  bootstrap: boolean
}

export function decideSignup(input: {
  mode: SignupMode
  userCount: number
  hasInvitation: boolean
}): SignupDecision {
  if (input.userCount === 0) return { allowed: true, firstUser: true }
  if (input.mode === 'open' || input.hasInvitation) return { allowed: true, firstUser: false }
  return { allowed: false, reason: 'invite_only' }
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(user)
  return row?.value ?? 0
}

/** A pending, unexpired invitation exists for the email (case-insensitive). */
export async function hasPendingInvitation(email: string, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(sql`lower(${invitation.email})`, email.trim().toLowerCase()),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, now),
      ),
    )
    .limit(1)
  return row !== undefined
}

export async function evaluateSignup(email: string, mode: SignupMode): Promise<SignupDecision> {
  const userCount = await countUsers()
  if (userCount === 0) return decideSignup({ mode, userCount, hasInvitation: false })
  const hasInvitation = mode === 'invite' ? await hasPendingInvitation(email) : false
  return decideSignup({ mode, userCount, hasInvitation })
}

export async function getSignupPolicy(mode: SignupMode): Promise<SignupPolicy> {
  return { mode, bootstrap: (await countUsers()) === 0 }
}
