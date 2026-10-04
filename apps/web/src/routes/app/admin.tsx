import { createFileRoute, redirect } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/admin')({
  beforeLoad: ({ context }) => {
    if (!context.user.isAdmin) throw redirect({ to: '/app' })
  },
  component: () => (
    <div className="p-6">
      <PageHeader title="Instance admin" description="Coming soon." />
    </div>
  ),
})
