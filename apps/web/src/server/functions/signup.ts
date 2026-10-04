import { createServerFn } from '@tanstack/react-start'
import { env } from '@/lib/env'
import { getSignupPolicy as readSignupPolicy } from '@/server/auth/signup-policy'

/** Public: tells the auth pages whether sign-up is open, invite-only or bootstrapping. */
export const getSignupPolicy = createServerFn({ method: 'GET' }).handler(async () => {
  return readSignupPolicy(env().AUTH_SIGNUP_MODE)
})
