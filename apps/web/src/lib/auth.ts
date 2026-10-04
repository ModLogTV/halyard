import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { admin, organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { env } from '@/lib/env'
import { ac, roles } from '@/lib/permissions'
import { ipAddressOptions, parseTrustedProxies } from '@/lib/trusted-proxies'
import { evaluateSignup } from '@/server/auth/signup-policy'
import { MANAGEMENT_KEY_PREFIX, SDK_KEY_PREFIX } from './key-prefixes'

// Kept in a separate module so client code can use them without importing the server.
export { MANAGEMENT_KEY_PREFIX, SDK_KEY_PREFIX }

export const auth = betterAuth({
  appName: 'Halyard',
  baseURL: env().BETTER_AUTH_URL,
  secret: env().BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  databaseHooks: {
    user: {
      create: {
        // Sign-up policy (see AUTH_SIGNUP_MODE): the first account becomes the instance
        // admin; afterwards invite mode only admits emails with a pending invitation.
        // Accounts created by admins (/admin/create-user) bypass the policy.
        before: async (user, ctx) => {
          if (ctx?.path !== '/sign-up/email') return
          const decision = await evaluateSignup(user.email, env().AUTH_SIGNUP_MODE)
          if (!decision.allowed) {
            throw new APIError('FORBIDDEN', {
              code: 'SIGNUP_INVITE_ONLY',
              message: 'Sign-up is by invitation only. Ask a project owner to invite you.',
            })
          }
          if (decision.firstUser) return { data: { ...user, role: 'admin' } }
        },
      },
    },
  },
  rateLimit: {
    // Counts are stored in Postgres so limits hold across replicas. Enabled in production
    // only (better-auth default), keyed by the client IP (see advanced.ipAddress).
    storage: 'database',
    modelName: 'rateLimit',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 3600, max: 20 },
      '/request-password-reset': { window: 3600, max: 5 },
    },
  },
  advanced: {
    // Another better-auth app on the same parent domain that shares its cookies across
    // subdomains sends a same-named session cookie along, and browsers put the older one
    // first. Our own prefix keeps that cookie from shadowing Halyard's session.
    cookiePrefix: 'halyard',
    // Forwarding headers are only honoured from the proxies listed in TRUSTED_PROXIES.
    ipAddress: ipAddressOptions(parseTrustedProxies(env().TRUSTED_PROXIES)),
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: 'owner',
      allowUserToCreateOrganization: true,
      // Invitations are accepted in-app; email delivery is an operator concern.
      sendInvitationEmail: async () => {},
    }),
    admin(),
    apiKey([
      {
        configId: 'sdk',
        references: 'organization',
        defaultPrefix: SDK_KEY_PREFIX,
        enableMetadata: true,
        rateLimit: { enabled: false },
        keyExpiration: { defaultExpiresIn: null },
        startingCharactersConfig: { shouldStore: true, charactersLength: 12 },
      },
      {
        configId: 'management',
        references: 'organization',
        defaultPrefix: MANAGEMENT_KEY_PREFIX,
        enableMetadata: true,
        rateLimit: { enabled: false },
        keyExpiration: { defaultExpiresIn: null },
        startingCharactersConfig: { shouldStore: true, charactersLength: 13 },
      },
    ]),
    tanstackStartCookies(),
  ],
})

export type Session = typeof auth.$Infer.Session
