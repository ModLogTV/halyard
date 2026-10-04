import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import {
  HistoryIcon,
  KeyRoundIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  WebhookIcon,
} from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatDelta } from '@/components/schedules/utils'
import { ConfirmDialog } from '@/components/settings/confirm-dialog'
import { errorMessage } from '@/components/settings/form-utils'
import { DisabledHint, HintedButton } from '@/components/settings/hinted-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  deleteWebhook,
  rotateWebhookSecret,
  sendTestWebhook,
  updateWebhook,
} from '@/server/functions/webhooks'
import type { Webhook } from '@/server/services/webhooks'
import { DeliveryDot } from './delivery-status'
import type { RevealedSecret } from './secret-reveal-dialog'

const MAX_EVENT_BADGES = 3

export function EventBadges({ events }: { events: string[] }) {
  const { t } = useTranslation('settings')
  const shown = events.slice(0, MAX_EVENT_BADGES)
  const rest = events.slice(MAX_EVENT_BADGES)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((event) => (
        <Badge key={event} variant="secondary" className="font-mono font-normal">
          {event === '*' ? t('webhooks.list.allEvents') : event}
        </Badge>
      ))}
      {rest.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" tabIndex={0} className="font-normal">
              +{rest.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs font-mono">{rest.join(', ')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export interface WebhookListProps {
  projectId: string
  projectSlug: string
  webhooks: Webhook[]
  isOwner: boolean
  onAdd: () => void
  onEdit: (webhook: Webhook) => void
  onReveal: (revealed: RevealedSecret) => void
}

export function WebhookList({
  projectId,
  projectSlug,
  webhooks,
  isOwner,
  onAdd,
  onEdit,
  onReveal,
}: WebhookListProps) {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const router = useRouter()
  const navigate = useNavigate()
  // Optimistic state of the enabled switches while the request is in flight.
  const [enabledOverride, setEnabledOverride] = useState<Record<string, boolean>>({})
  const [rotating, setRotating] = useState<Webhook | null>(null)
  const [deleting, setDeleting] = useState<Webhook | null>(null)
  const reason = isOwner ? undefined : t('shared.ownerOnly')

  async function setEnabled(webhook: Webhook, enabled: boolean) {
    setEnabledOverride((prev) => ({ ...prev, [webhook.id]: enabled }))
    try {
      await updateWebhook({ data: { projectId, webhookId: webhook.id, patch: { enabled } } })
      toast.success(
        enabled
          ? t('webhooks.list.enabledToast', { name: webhook.name })
          : t('webhooks.list.disabledToast', { name: webhook.name }),
      )
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error, t('webhooks.list.updateFailed')))
    } finally {
      setEnabledOverride((prev) => {
        const { [webhook.id]: _, ...rest } = prev
        return rest
      })
    }
  }

  async function sendTest(webhook: Webhook) {
    try {
      await sendTestWebhook({ data: { projectId, webhookId: webhook.id } })
      toast.success(t('webhooks.testQueued'), {
        description: t('webhooks.testQueuedDescription'),
        action: {
          label: t('webhooks.list.viewDeliveries'),
          onClick: () =>
            void navigate({
              to: '/app/$projectSlug/settings/webhooks/$webhookId',
              params: { projectSlug, webhookId: webhook.id },
            }),
        },
      })
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error, t('webhooks.testFailed')))
    }
  }

  if (webhooks.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WebhookIcon />
          </EmptyMedia>
          <EmptyTitle>{t('webhooks.empty.title')}</EmptyTitle>
          <EmptyDescription>{t('webhooks.empty.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <HintedButton onClick={onAdd} disabledReason={reason}>
            {t('webhooks.add')}
          </HintedButton>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <ItemGroup className="gap-2">
        <AnimatePresence initial={false}>
          {webhooks.map((webhook) => {
            const enabled = enabledOverride[webhook.id] ?? webhook.enabled
            const last = webhook.lastDelivery
            return (
              <motion.div
                key={webhook.id}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                role="listitem"
              >
                <Item variant="outline" size="sm" className={enabled ? undefined : 'bg-muted/30'}>
                  <ItemContent className="min-w-0 basis-64 gap-1.5">
                    <ItemTitle className="flex-wrap">
                      <Link
                        to="/app/$projectSlug/settings/webhooks/$webhookId"
                        params={{ projectSlug, webhookId: webhook.id }}
                        className="underline-offset-4 hover:underline"
                      >
                        {webhook.name}
                      </Link>
                      {enabled ? null : (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          {t('common:states.disabled')}
                        </Badge>
                      )}
                      {last ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so the tooltip is reachable by keyboard
                              tabIndex={0}
                              className="inline-flex items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                            >
                              <DeliveryDot status={last.status} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <Trans
                              t={t}
                              i18nKey={
                                last.lastStatusCode
                                  ? 'webhooks.list.lastDeliveryWithCode'
                                  : 'webhooks.list.lastDelivery'
                              }
                              values={{
                                event: last.eventType,
                                status: t(`webhooks.deliveries.statusInline.${last.status}`),
                                code: last.lastStatusCode,
                                when: formatDelta(last.createdAt, new Date(), i18n.language),
                              }}
                              components={[<span key="event" className="font-mono" />]}
                            />
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </ItemTitle>
                    <p
                      className="max-w-full truncate font-mono text-muted-foreground text-xs"
                      title={webhook.url}
                    >
                      {webhook.url}
                    </p>
                    <EventBadges events={webhook.events} />
                  </ItemContent>
                  <ItemActions>
                    {reason ? (
                      <DisabledHint reason={reason}>
                        <Switch
                          checked={enabled}
                          disabled
                          aria-label={t('webhooks.list.enableAria', { name: webhook.name })}
                        />
                      </DisabledHint>
                    ) : (
                      <Switch
                        checked={enabled}
                        onCheckedChange={(checked) => void setEnabled(webhook, checked)}
                        aria-label={t('webhooks.list.enableAria', { name: webhook.name })}
                      />
                    )}
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('webhooks.list.actionsAria', { name: webhook.name })}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>{t('common:labels.actions')}</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link
                            to="/app/$projectSlug/settings/webhooks/$webhookId"
                            params={{ projectSlug, webhookId: webhook.id }}
                          >
                            <HistoryIcon /> {t('webhooks.list.deliveries')}
                          </Link>
                        </DropdownMenuItem>
                        {isOwner ? (
                          <>
                            <DropdownMenuItem onClick={() => onEdit(webhook)}>
                              <PencilIcon /> {t('common:actions.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!enabled}
                              onClick={() => void sendTest(webhook)}
                            >
                              <SendIcon /> {t('webhooks.sendTest')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setRotating(webhook)}>
                              <KeyRoundIcon /> {t('webhooks.list.rotateSecret')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleting(webhook)}
                            >
                              <Trash2Icon /> {t('common:actions.delete')}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </Item>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </ItemGroup>

      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => {
          if (!open) setRotating(null)
        }}
        title={t('webhooks.list.rotate.title', {
          name: rotating?.name ?? t('webhooks.list.rotate.fallbackName'),
        })}
        description={t('webhooks.list.rotate.description')}
        confirmLabel={t('webhooks.list.rotate.confirm')}
        onConfirm={async () => {
          if (!rotating) return
          const result = await rotateWebhookSecret({
            data: { projectId, webhookId: rotating.id },
          })
          await router.invalidate()
          onReveal({ kind: 'rotated', name: rotating.name, secret: result.secret })
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('webhooks.list.delete.title', {
          name: deleting?.name ?? t('webhooks.list.rotate.fallbackName'),
        })}
        description={t('webhooks.list.delete.description')}
        confirmLabel={t('webhooks.list.delete.confirm')}
        onConfirm={async () => {
          if (!deleting) return
          await deleteWebhook({ data: { projectId, webhookId: deleting.id } })
          toast.success(t('webhooks.list.delete.deleted', { name: deleting.name }))
          await router.invalidate()
        }}
      />
    </MotionConfig>
  )
}
