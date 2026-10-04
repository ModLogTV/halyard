import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeftIcon, SendIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/components/settings/form-utils'
import { HintedButton } from '@/components/settings/hinted-button'
import { SettingsPending } from '@/components/settings/settings-section'
import { OWNER_ONLY_MESSAGE, useSettingsContext } from '@/components/settings/use-settings-context'
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
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.webhook.name ?? 'Webhook'} · Webhooks · Halyard` }],
  }),
  pendingComponent: () => <SettingsPending rows={4} />,
  notFoundComponent: () => {
    const { projectSlug } = Route.useParams()
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>Webhook not found</EmptyTitle>
          <EmptyDescription>It may have been deleted.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to="/app/$projectSlug/settings/webhooks" params={{ projectSlug }}>
              Back to webhooks
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  },
  errorComponent: ({ error, reset }) => (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyTitle>Could not load deliveries</EmptyTitle>
        <EmptyDescription>
          {error instanceof Error ? error.message : 'Something went wrong.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  ),
  component: WebhookDeliveries,
})

function WebhookDeliveries() {
  const { project, isOwner } = useSettingsContext()
  const { webhook, deliveries } = Route.useLoaderData()
  const [sending, setSending] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  async function sendTest() {
    setSending(true)
    try {
      await sendTestWebhook({ data: { projectId: project.id, webhookId: webhook.id } })
      toast.success('Test event queued', { description: 'It is sent within a few seconds.' })
      setRefreshKey((key) => key + 1)
    } catch (error) {
      toast.error(errorMessage(error, 'Could not send the test event'))
    } finally {
      setSending(false)
    }
  }

  const testReason = !isOwner
    ? OWNER_ONLY_MESSAGE
    : webhook.enabled
      ? undefined
      : 'Enable the webhook before sending a test event'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/settings/webhooks" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> Webhooks
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
                {webhook.enabled ? 'Enabled' : 'Disabled'}
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
              Secret <span className="font-mono">{webhook.secretPreview}</span> · created{' '}
              {formatDateTime(webhook.createdAt)}
            </p>
          </div>
          <HintedButton
            variant="outline"
            onClick={() => void sendTest()}
            disabledReason={testReason}
          >
            {sending ? <Spinner /> : <SendIcon />} Send test event
          </HintedButton>
        </div>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="deliveries-heading">
        <h3 id="deliveries-heading" className="font-semibold text-base tracking-tight">
          Deliveries
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
