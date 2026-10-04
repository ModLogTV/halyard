import { createServerFn } from '@tanstack/react-start'
import { projectActor } from '@/server/request-actor'
import { flagAnalyticsSchema, projectAnalyticsSchema } from '@/server/schemas/analytics'
import * as analytics from '@/server/services/analytics'

export const getProjectAnalytics = createServerFn({ method: 'GET' })
  .validator(projectAnalyticsSchema)
  .handler(async ({ data }) =>
    analytics.getProjectAnalytics(await projectActor(data.projectId, { flag: ['read'] }), data),
  )

export const getFlagAnalytics = createServerFn({ method: 'GET' })
  .validator(flagAnalyticsSchema)
  .handler(async ({ data }) =>
    analytics.getFlagAnalytics(await projectActor(data.projectId, { flag: ['read'] }), data),
  )
