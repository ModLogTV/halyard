import { createFileRoute, type ErrorComponentProps, Link, notFound } from '@tanstack/react-router'
import { ArrowLeftIcon, SendIcon } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { errorMessage } from '@/components/settings/form-utils'
import { HintedButton } from '@/components/settings/hinted-button'
import { SettingsPending } from '@/components/settings/settings-section'
import { useSettingsContext } from '@/components/settings/use-settings-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { SignatureCard } from '@/components/webhooks'
import { DeliveryTable } from '@/components/webhooks/delivery-table'
import { EventBadges } from '@/components/webhooks/webhook-list'
import { formatDateTime } from '@/lib/format'
import { translate } from '@/lib/i18n'
import { getWebhook, listWebhookDeliveries, sendTestWebhook } from '@/server/functions/webhooks'

export const Route = createFileRoute('/app/$projectSlug/settings/webhooks/$webhookId')({
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData?.projectId
    if (!projectId) throw notFound()
    const webhookId = params.webhookId
    const [webhook, deliveries] = await Promise.all([
      getWebhook({ data: { projectId, webhookId } }).catch(() => null),
      listWebhookDeliveries({ data: { projectId, webhookId, limit: 50 } }).catch(() => null),
    ])
    if (!webhook || !deliveries) throw notFound()
    return { webhook, deliveries, crumb: webhook.name }
  },
  head: ({ loaderData, match }) => {
    const t = translate(match.context.locale)
    return {
      meta: [
        {
          title: t('settings:webhooks.detailPageTitle', {
            name: loaderData?.webhook.name ?? t('common:labels.webhook'),
          }),
        },
      ],
    }
  },
  pendingComponent: () => <SettingsPending rows={4} />,
  notFoundComponent: WebhookNotFound,
  errorComponent: WebhookError,
  component: WebhookDeliveries,
})

function WebhookNotFound() {
  const { t } = useTranslation('settings')
  const { projectSlug } = Route.useParams()
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyTitle>{t('webhooks.detail.notFoundTitle')}</EmptyTitle>
        <EmptyDescription>{t('webhooks.detail.notFoundDescription')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to="/app/$projectSlug/settings/webhooks" params={{ projectSlug }}>
            {t('webhooks.detail.back')}
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function WebhookError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyTitle>{t('webhooks.detail.loadFailedTitle')}</EmptyTitle>
        <EmptyDescription>
          {error instanceof Error ? error.message : t('common:errors.generic')}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={reset}>
          {t('common:actions.tryAgain')}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function WebhookDeliveries() {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const { project, isOwner } = useSettingsContext()
  const { webhook, deliveries } = Route.useLoaderData()
  const [sending, setSending] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  async function sendTest() {
    setSending(true)
    try {
      await sendTestWebhook({ data: { projectId: project.id, webhookId: webhook.id } })
      toast.success(t('webhooks.testQueued'), { description: t('webhooks.testQueuedDescription') })
      setRefreshKey((key) => key + 1)
    } catch (error) {
      toast.error(errorMessage(error, t('webhooks.testFailed')))
    } finally {
      setSending(false)
    }
  }

  const testReason = !isOwner
    ? t('shared.ownerOnly')
    : webhook.enabled
      ? undefined
      : t('webhooks.enableBeforeTest')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/settings/webhooks" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> {t('common:labels.webhooks')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="flex flex-wrap items-center gap-2 font-semibold text-lg tracking-tight">
              {webhook.name}
              <Badge
                variant="outline"
                className={
                  webhook.enabled ? 'border-transparent bg-on-soft' : 'text-muted-foreground'
                }
              >
                {webhook.enabled ? t('common:states.enabled') : t('common:states.disabled')}
              </Badge>
            </h2>
            <p
              className="max-w-full truncate font-mono text-muted-foreground text-sm"
              title={webhook.url}
            >
              {webhook.url}
            </p>
            <EventBadges events={webhook.events} />
            <p className="text-muted-foreground text-xs">
              <Trans
                t={t}
                i18nKey="webhooks.detail.secretLine"
                values={{
                  preview: webhook.secretPreview,
                  time: formatDateTime(webhook.createdAt, i18n.language),
                }}
                components={[<span key="preview" className="font-mono" />]}
              />
            </p>
          </div>
          <HintedButton
            variant="outline"
            onClick={() => void sendTest()}
            disabledReason={testReason}
          >
            {sending ? <Spinner /> : <SendIcon />} {t('webhooks.sendTest')}
          </HintedButton>
        </div>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="deliveries-heading">
        <h3 id="deliveries-heading" className="font-semibold text-base tracking-tight">
          {t('webhooks.deliveries.title')}
        </h3>
        <DeliveryTable
          projectId={project.id}
          webhookId={webhook.id}
          initial={deliveries}
          canManage={isOwner}
          webhookEnabled={webhook.enabled}
          refreshKey={refreshKey}
        />
      </section>

      <SignatureCard />
    </div>
  )
}
