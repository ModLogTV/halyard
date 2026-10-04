import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/app/$projectSlug/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/app/$projectSlug/flags', params })
  },
})
