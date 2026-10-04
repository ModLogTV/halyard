import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/$projectSlug/experiments')({
  staticData: { crumb: 'Experiments' },
  component: () => (
    <div className="p-6">
      <PageHeader title="Experiments" description="Coming soon." />
    </div>
  ),
})
