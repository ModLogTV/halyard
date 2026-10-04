import { createFileRoute } from '@tanstack/react-router'
import { withManagementKey } from '@/server/api/auth'
import { getProjectById } from '@/server/services/projects'

/** The project a management key belongs to, with its environments. */
export const Route = createFileRoute('/api/v1/projects/current')({
  server: {
    handlers: {
      GET: withManagementKey(async ({ principal }) => {
        const project = await getProjectById(principal.projectId)
        return Response.json({
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description,
          environments: project.environments.map((env) => ({
            id: env.id,
            key: env.key,
            name: env.name,
            color: env.color,
            isProduction: env.isProduction,
          })),
        })
      }),
    },
  },
})
