import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import {
  createManagementKeySchema,
  createSdkKeySchema,
  listApiKeysSchema,
  revokeApiKeySchema,
} from '@/server/schemas/api-keys'
import * as apiKeys from '@/server/services/api-keys'

export const listApiKeys = createServerFn({ method: 'GET' })
  .inputValidator(listApiKeysSchema)
  .handler(async ({ data }) =>
    apiKeys.listApiKeys(await projectActor(data.projectId, { apiKey: ['read'] }), data),
  )

/** Returns `{ id, key, start }`; the plaintext key is shown once. */
export const createSdkKey = createServerFn({ method: 'POST' })
  .inputValidator(createSdkKeySchema)
  .handler(async ({ data }) =>
    apiKeys.createSdkKey(await projectActor(data.projectId, { apiKey: ['create'] }), data),
  )

/** Returns `{ id, key, start }`; the plaintext key is shown once. */
export const createManagementKey = createServerFn({ method: 'POST' })
  .inputValidator(createManagementKeySchema)
  .handler(async ({ data }) =>
    apiKeys.createManagementKey(await projectActor(data.projectId, { apiKey: ['create'] }), data),
  )

export const revokeApiKey = createServerFn({ method: 'POST' })
  .inputValidator(revokeApiKeySchema)
  .handler(async ({ data }) =>
    apiKeys.revokeApiKey(await projectActor(data.projectId, { apiKey: ['delete'] }), data),
  )
