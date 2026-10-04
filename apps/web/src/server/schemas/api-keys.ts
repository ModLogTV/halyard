import { z } from 'zod'
import { nameSchema, projectIdSchema, uuidSchema } from './common'

export const API_KEY_CONFIG_IDS = ['sdk', 'management'] as const
export const apiKeyConfigIdSchema = z.enum(API_KEY_CONFIG_IDS)

export const listApiKeysSchema = z.object({ projectId: projectIdSchema })

export const createSdkKeySchema = z.object({
  projectId: projectIdSchema,
  environmentId: uuidSchema,
  name: nameSchema.max(64),
})
export type CreateSdkKeyInput = z.input<typeof createSdkKeySchema>

export const createManagementKeySchema = z.object({
  projectId: projectIdSchema,
  name: nameSchema.max(64),
  access: z.enum(['read', 'write']),
})
export type CreateManagementKeyInput = z.input<typeof createManagementKeySchema>

export const revokeApiKeySchema = z.object({
  projectId: projectIdSchema,
  keyId: z.string().min(1),
  configId: apiKeyConfigIdSchema,
})
export type RevokeApiKeyInput = z.input<typeof revokeApiKeySchema>
