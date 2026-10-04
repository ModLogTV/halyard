import { createFileRoute } from '@tanstack/react-router'
import { withManagementKey } from '@/server/api/auth'
import { badRequest } from '@/server/errors'
import { exportFlagd } from '@/server/services/transfer'

/** flagd definition of one environment: `?environment=<key>`. */
export const Route = createFileRoute('/api/v1/export/flagd')({
  server: {
    handlers: {
      GET: withManagementKey(async ({ request, actor, principal }) => {
        const environmentKey = new URL(request.url).searchParams.get('environment')
        if (!environmentKey)
          throw badRequest('Provide the environment to export as ?environment=<key>')
        const { flagd, warnings } = await exportFlagd(actor, {
          projectId: principal.projectId,
          environmentKey,
        })
        return Response.json({ flagd, warnings })
      }),
    },
  },
})
