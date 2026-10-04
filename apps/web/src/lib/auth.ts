import { apiKey } from '@better-auth/api-key'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { env } from '@/lib/env'
import { ac, roles } from '@/lib/permissions'

/** Prefix for environment-scoped SDK keys used by OFREP and the tracking endpoint. */
export const SDK_KEY_PREFIX = 'hal_sdk_'
/** Prefix for project-scoped management keys used by the CLI and the REST API. */
export const MANAGEMENT_KEY_PREFIX = 'hal_mgmt_'

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
