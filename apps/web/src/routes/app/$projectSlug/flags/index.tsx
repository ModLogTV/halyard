import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/$projectSlug/flags/')({
  staticData: { crumb: 'Flags' },
  component: () => (
    <div className="p-6">
      <PageHeader title="Flags" description="Coming soon." />
    </div>
  ),
})
