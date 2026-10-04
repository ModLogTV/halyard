import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/$projectSlug/schedules')({
  staticData: { crumb: 'Schedules' },
  component: () => (
    <div className="p-6">
      <PageHeader title="Schedules" description="Coming soon." />
    </div>
  ),
})
