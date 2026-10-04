import { apiKeyClient } from '@better-auth/api-key/client'
import { adminClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { ac, roles } from '@/lib/permissions'

export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles }), adminClient(), apiKeyClient()],
})

export const { useSession, signIn, signUp, signOut } = authClient
