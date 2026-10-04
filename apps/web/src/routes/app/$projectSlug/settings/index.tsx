import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/$projectSlug/settings/')({
  staticData: { crumb: 'Settings' },
  component: () => (
    <div className="p-6">
      <PageHeader title="Settings" description="Coming soon." />
    </div>
  ),
})
