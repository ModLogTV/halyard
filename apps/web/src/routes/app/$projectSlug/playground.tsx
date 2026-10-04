import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/$projectSlug/playground')({
  staticData: { crumb: 'Playground' },
  component: () => (
    <div className="p-6">
      <PageHeader title="Playground" description="Coming soon." />
    </div>
  ),
})
