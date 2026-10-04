import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/app/$projectSlug/compare')({
  staticData: { crumb: 'Compare' },
  component: () => (
    <div className="p-6">
      <PageHeader title="Compare" description="Coming soon." />
    </div>
  ),
})
