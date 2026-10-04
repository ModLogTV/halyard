import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import {
  createWebhookSchema,
  listWebhookDeliveriesSchema,
  listWebhooksSchema,
  redeliverWebhookSchema,
  updateWebhookSchema,
  webhookRefSchema,
} from '@/server/schemas/webhooks'
import * as webhooks from '@/server/services/webhooks'

export const listWebhooks = createServerFn({ method: 'GET' })
  .validator(listWebhooksSchema)
  .handler(async ({ data }) =>
    webhooks.listWebhooks(await projectActor(data.projectId, { webhook: ['read'] }), data),
  )

export const getWebhook = createServerFn({ method: 'GET' })
  .validator(webhookRefSchema)
  .handler(async ({ data }) =>
    webhooks.getWebhook(await projectActor(data.projectId, { webhook: ['read'] }), data),
  )

/** Event types offered in the UI; static, so no project permission is needed. */
export const listWebhookEventTypes = createServerFn({ method: 'GET' }).handler(
  async () => webhooks.WEBHOOK_EVENT_TYPES,
)

/** Returns the full secret; it is not shown again. */
export const createWebhook = createServerFn({ method: 'POST' })
  .validator(createWebhookSchema)
  .handler(async ({ data }) =>
    webhooks.createWebhook(await projectActor(data.projectId, { webhook: ['create'] }), data),
  )

export const updateWebhook = createServerFn({ method: 'POST' })
  .validator(updateWebhookSchema)
  .handler(async ({ data }) =>
    webhooks.updateWebhook(await projectActor(data.projectId, { webhook: ['update'] }), data),
  )

export const rotateWebhookSecret = createServerFn({ method: 'POST' })
  .validator(webhookRefSchema)
  .handler(async ({ data }) =>
    webhooks.rotateSecret(await projectActor(data.projectId, { webhook: ['update'] }), data),
  )

export const deleteWebhook = createServerFn({ method: 'POST' })
  .validator(webhookRefSchema)
  .handler(async ({ data }) =>
    webhooks.deleteWebhook(await projectActor(data.projectId, { webhook: ['delete'] }), data),
  )

export const listWebhookDeliveries = createServerFn({ method: 'GET' })
  .validator(listWebhookDeliveriesSchema)
  .handler(async ({ data }) =>
    webhooks.listDeliveries(await projectActor(data.projectId, { webhook: ['read'] }), data),
  )

export const redeliverWebhook = createServerFn({ method: 'POST' })
  .validator(redeliverWebhookSchema)
  .handler(async ({ data }) =>
    webhooks.redeliver(await projectActor(data.projectId, { webhook: ['update'] }), data),
  )

export const sendTestWebhook = createServerFn({ method: 'POST' })
  .validator(webhookRefSchema)
  .handler(async ({ data }) =>
    webhooks.sendTestWebhook(await projectActor(data.projectId, { webhook: ['update'] }), data),
  )
