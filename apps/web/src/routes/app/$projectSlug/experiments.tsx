import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/app/$projectSlug/experiments')({
  staticData: { crumb: 'Experiments' },
  // Exposes the project id so child loaders do not reach past this layout.
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    return { projectId: parent.loaderData!.project.id }
  },
  component: () => <Outlet />,
})
