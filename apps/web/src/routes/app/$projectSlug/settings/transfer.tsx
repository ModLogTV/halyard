import { createFileRoute } from '@tanstack/react-router'
import { useSettingsContext } from '@/components/settings/use-settings-context'
import { ExportCard } from '@/components/transfer/export-card'
import { ImportCard } from '@/components/transfer/import-card'

export const Route = createFileRoute('/app/$projectSlug/settings/transfer')({
  staticData: { crumbKey: 'transfer' },
  head: () => ({ meta: [{ title: 'Import & export · Halyard' }] }),
  component: TransferSettings,
})

function TransferSettings() {
  const { project } = useSettingsContext()
  const environments = [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="flex flex-col gap-8">
      <ExportCard projectId={project.id} projectSlug={project.slug} environments={environments} />
      <ImportCard
        projectId={project.id}
        environments={environments}
        canImport={project.role !== 'viewer'}
      />
    </div>
  )
}
