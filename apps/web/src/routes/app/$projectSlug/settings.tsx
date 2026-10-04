import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import {
  ArrowLeftRightIcon,
  KeyRoundIcon,
  LayersIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  WebhookIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/app/$projectSlug/settings')({
  staticData: { crumb: 'Settings' },
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    return { projectId: parent.loaderData?.project.id ?? null }
  },
  head: () => ({ meta: [{ title: 'Settings · Halyard' }] }),
  component: SettingsLayout,
})

const activeProps = {
  'aria-current': 'page' as const,
  className: 'bg-accent text-accent-foreground',
}

function SettingsLayout() {
  const { projectSlug } = Route.useParams()
  const params = { projectSlug }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-8">
      <PageHeader
        title="Settings"
        description="Manage this project, who can use it and how it is accessed."
      />
      <nav aria-label="Settings" className="-mx-1 overflow-x-auto px-1 pb-1">
        <ul className="flex items-center gap-1 border-b pb-2">
          <li>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/$projectSlug/settings"
                params={params}
                activeOptions={{ exact: true }}
                activeProps={activeProps}
              >
                <SlidersHorizontalIcon /> General
              </Link>
            </Button>
          </li>
          <li>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/$projectSlug/settings/environments"
                params={params}
                activeProps={activeProps}
              >
                <LayersIcon /> Environments
              </Link>
            </Button>
          </li>
          <li>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/$projectSlug/settings/members"
                params={params}
                activeProps={activeProps}
              >
                <UsersIcon /> Members
              </Link>
            </Button>
          </li>
          <li>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/$projectSlug/settings/api-keys"
                params={params}
                activeProps={activeProps}
              >
                <KeyRoundIcon /> API keys
              </Link>
            </Button>
          </li>
          <li>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/$projectSlug/settings/webhooks"
                params={params}
                activeProps={activeProps}
              >
                <WebhookIcon /> Webhooks
              </Link>
            </Button>
          </li>
          <li>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/$projectSlug/settings/transfer"
                params={params}
                activeProps={activeProps}
              >
                <ArrowLeftRightIcon /> Import &amp; export
              </Link>
            </Button>
          </li>
        </ul>
      </nav>
      <Outlet />
    </div>
  )
}
