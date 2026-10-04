import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '@/server/functions/session'

export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { session }
  },
  component: () => <Outlet />,
})
