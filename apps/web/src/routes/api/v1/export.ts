import { createFileRoute } from '@tanstack/react-router'
import { withManagementKey } from '@/server/api/auth'
import { exportProject } from '@/server/services/transfer'

/** The export document (format v1). `?download=1` adds a `Content-Disposition` header. */
export const Route = createFileRoute('/api/v1/export')({
  server: {
    handlers: {
      GET: withManagementKey(async ({ request, actor, principal }) => {
        const document = await exportProject(actor, { projectId: principal.projectId })
        const headers = new Headers()
        const download = new URL(request.url).searchParams.get('download')
        if (download === '1' || download === 'true') {
          headers.set(
            'Content-Disposition',
            `attachment; filename="${document.project.slug}-export.json"`,
          )
        }
        return Response.json(document, { headers })
      }),
    },
  },
})
