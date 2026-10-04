import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/$projectSlug/segments/')({
  staticData: { crumb: 'Segments' },
  component: () => (
    <div className="p-6">
      <PageHeader title="Segments" description="Coming soon." />
    </div>
  ),
})
