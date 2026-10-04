import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import {
  ArrowLeftRightIcon,
  BotIcon,
  KeyRoundIcon,
  LayersIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  WebhookIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { translate } from '@/lib/i18n'

export const Route = createFileRoute('/app/$projectSlug/settings')({
  staticData: { crumbKey: 'settings' },
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    return { projectId: parent.loaderData?.project.id ?? null }
  },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('settings:nav.pageTitle') }],
  }),
  component: SettingsLayout,
})

const activeProps = {
  'aria-current': 'page' as const,
  className: 'bg-accent text-accent-foreground',
}

function SettingsLayout() {
  const { t } = useTranslation(['settings', 'common'])
  const { projectSlug } = Route.useParams()
  const params = { projectSlug }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-8">
      <PageHeader title={t('common:labels.settings')} description={t('nav.description')} />
      <nav aria-label={t('common:labels.settings')} className="-mx-1 overflow-x-auto px-1 pb-1">
        <ul className="flex items-center gap-1 border-b pb-2">
          <li>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/$projectSlug/settings"
                params={params}
                activeOptions={{ exact: true }}
                activeProps={activeProps}
              >
                <SlidersHorizontalIcon /> {t('common:labels.general')}
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
                <LayersIcon /> {t('common:labels.environments')}
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
                <UsersIcon /> {t('common:labels.members')}
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
                <KeyRoundIcon /> {t('common:labels.apiKeys')}
              </Link>
            </Button>
          </li>
          <li>
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/$projectSlug/settings/mcp" params={params} activeProps={activeProps}>
                <BotIcon /> {t('nav.mcp')}
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
                <WebhookIcon /> {t('common:labels.webhooks')}
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
                <ArrowLeftRightIcon /> {t('nav.transfer')}
              </Link>
            </Button>
          </li>
        </ul>
      </nav>
      <Outlet />
    </div>
  )
}
