import {
  createFileRoute,
  type ErrorComponentProps,
  Outlet,
  useChildMatches,
} from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HintedButton } from '@/components/settings/hinted-button'
import { SettingsPending, SettingsSection } from '@/components/settings/settings-section'
import { useSettingsContext } from '@/components/settings/use-settings-context'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { SignatureCard } from '@/components/webhooks'
import { type RevealedSecret, SecretRevealDialog } from '@/components/webhooks/secret-reveal-dialog'
import { WebhookFormDialog } from '@/components/webhooks/webhook-form-dialog'
import { WebhookList } from '@/components/webhooks/webhook-list'
import { translate } from '@/lib/i18n'
import { listWebhookEventTypes, listWebhooks } from '@/server/functions/webhooks'
import type { Webhook } from '@/server/services/webhooks'

export const Route = createFileRoute('/app/$projectSlug/settings/webhooks')({
  staticData: { crumbKey: 'webhooks' },
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData?.projectId
    if (!projectId) return { projectId: null, webhooks: [], eventTypes: [] }
    const [webhooks, eventTypes] = await Promise.all([
      listWebhooks({ data: { projectId } }),
      listWebhookEventTypes(),
    ])
    return { projectId, webhooks, eventTypes }
  },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('settings:webhooks.pageTitle') }],
  }),
  pendingComponent: () => <SettingsPending rows={3} />,
  errorComponent: WebhooksError,
  component: WebhooksRoute,
})

function WebhooksError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyTitle>{t('webhooks.loadFailedTitle')}</EmptyTitle>
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

/** The list is this route's own page; the deliveries view is a child route rendered instead of it. */
function WebhooksRoute() {
  const children = useChildMatches()
  if (children.length > 0) return <Outlet />
  return <WebhooksSettings />
}

function WebhooksSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const { project, isOwner } = useSettingsContext()
  const { webhooks, eventTypes } = Route.useLoaderData()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Webhook | null>(null)
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null)

  const addButton = (
    <HintedButton
      onClick={() => {
        setEditing(null)
        setFormOpen(true)
      }}
      disabledReason={isOwner ? undefined : t('shared.ownerOnly')}
    >
      <PlusIcon /> {t('webhooks.add')}
    </HintedButton>
  )

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title={t('common:labels.webhooks')}
        description={t('webhooks.description')}
        actions={webhooks.length > 0 ? addButton : undefined}
      >
        <WebhookList
          projectId={project.id}
          projectSlug={project.slug}
          webhooks={webhooks}
          isOwner={isOwner}
          onAdd={() => {
            setEditing(null)
            setFormOpen(true)
          }}
          onEdit={(webhook) => {
            setEditing(webhook)
            setFormOpen(true)
          }}
          onReveal={setRevealed}
        />
        <SignatureCard />
      </SettingsSection>

      <WebhookFormDialog
        projectId={project.id}
        webhook={editing}
        eventTypes={eventTypes}
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={setRevealed}
      />
      <SecretRevealDialog revealed={revealed} onClose={() => setRevealed(null)} />
    </div>
  )
}
