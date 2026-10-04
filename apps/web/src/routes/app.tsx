import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { CommandPaletteProvider } from '@/components/command-palette'
import { listProjects } from '@/server/functions/projects'
import { getSession } from '@/server/functions/session'

export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    const role = session.user.role ?? 'user'
    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        isAdmin: role.split(',').includes('admin'),
      },
    }
  },
  loader: async () => ({ projects: await listProjects() }),
  component: AppLayout,
})

function AppLayout() {
  const { projects } = Route.useLoaderData()
  return (
    <CommandPaletteProvider projects={projects}>
      <Outlet />
    </CommandPaletteProvider>
  )
}
