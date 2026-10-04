import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/$projectSlug/audit')({
  staticData: { crumb: 'Audit log' },
  component: () => (
    <div className="p-6">
      <PageHeader title="Audit log" description="Coming soon." />
    </div>
  ),
})
