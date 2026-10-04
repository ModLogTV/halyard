import { z } from 'zod'
import { nameSchema, projectIdSchema, uuidSchema } from './common'

/** `*`, an exact event type such as `flag.toggled`, or a prefix pattern such as `flag.*`. */
export const WEBHOOK_EVENT_PATTERN = /^(\*|[a-z][a-z0-9_]*\.(\*|[a-z][a-z0-9_]*))$/

export const webhookEventSchema = z
  .string()
  .trim()
  .regex(WEBHOOK_EVENT_PATTERN, 'Use "*", an event type such as "flag.toggled" or "flag.*"')

export const webhookEventsSchema = z
  .array(webhookEventSchema)
  .min(1, 'Choose at least one event')
  .max(100)
  .transform((events) => [...new Set(events)])

export const webhookUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url('Enter a valid URL')
  .refine((value) => {
    try {
      const { protocol } = new URL(value)
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, 'The URL must start with http:// or https://')

export const webhookSecretSchema = z
  .string()
  .min(16, 'The secret must be at least 16 characters')
  .max(256)

export const listWebhooksSchema = z.object({ projectId: projectIdSchema })

export const webhookRefSchema = z.object({ projectId: projectIdSchema, webhookId: uuidSchema })
export type WebhookRefInput = z.input<typeof webhookRefSchema>

export const createWebhookSchema = z.object({
  projectId: projectIdSchema,
  name: nameSchema,
  url: webhookUrlSchema,
  events: webhookEventsSchema,
  /** Generated (32 random bytes, hex) when omitted. */
  secret: webhookSecretSchema.optional(),
})
export type CreateWebhookInput = z.input<typeof createWebhookSchema>

export const updateWebhookSchema = z.object({
  projectId: projectIdSchema,
  webhookId: uuidSchema,
  patch: z
    .object({
      name: nameSchema.optional(),
      url: webhookUrlSchema.optional(),
      events: webhookEventsSchema.optional(),
      enabled: z.boolean().optional(),
    })
    .strict(),
})
export type UpdateWebhookInput = z.input<typeof updateWebhookSchema>

export const listWebhookDeliveriesSchema = z.object({
  projectId: projectIdSchema,
  webhookId: uuidSchema,
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})
export type ListWebhookDeliveriesInput = z.input<typeof listWebhookDeliveriesSchema>

export const redeliverWebhookSchema = z.object({
  projectId: projectIdSchema,
  deliveryId: uuidSchema,
})
export type RedeliverWebhookInput = z.input<typeof redeliverWebhookSchema>
