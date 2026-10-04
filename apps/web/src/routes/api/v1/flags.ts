import { createFileRoute } from '@tanstack/react-router'
import { withManagementKey } from '@/server/api/auth'
import { listFlags } from '@/server/services/flags'

/** Flag definitions of the project (archived ones included), for example to generate types. */
export const Route = createFileRoute('/api/v1/flags')({
  server: {
    handlers: {
      GET: withManagementKey(async ({ actor, principal }) => {
        const flags = await listFlags(actor, {
          projectId: principal.projectId,
          includeArchived: true,
        })
        return Response.json({
          flags: flags.map((flag) => ({
            key: flag.key,
            name: flag.name,
            description: flag.description,
            type: flag.type,
            variants: flag.variants,
            tags: flag.tags,
            archived: flag.archivedAt !== null,
          })),
        })
      }),
    },
  },
})
