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
import { toast } from 'sonner'
import { formatDelta } from '@/components/schedules/utils'
import { ConfirmDialog } from '@/components/settings/confirm-dialog'
import { errorMessage } from '@/components/settings/form-utils'
import { DisabledHint, HintedButton } from '@/components/settings/hinted-button'
import { OWNER_ONLY_MESSAGE } from '@/components/settings/use-settings-context'
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
  const shown = events.slice(0, MAX_EVENT_BADGES)
  const rest = events.slice(MAX_EVENT_BADGES)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((event) => (
        <Badge key={event} variant="secondary" className="font-mono font-normal">
          {event === '*' ? 'all events' : event}
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
  const router = useRouter()
  const navigate = useNavigate()
  // Optimistic state of the enabled switches while the request is in flight.
  const [enabledOverride, setEnabledOverride] = useState<Record<string, boolean>>({})
  const [rotating, setRotating] = useState<Webhook | null>(null)
  const [deleting, setDeleting] = useState<Webhook | null>(null)
  const reason = isOwner ? undefined : OWNER_ONLY_MESSAGE

  async function setEnabled(webhook: Webhook, enabled: boolean) {
    setEnabledOverride((prev) => ({ ...prev, [webhook.id]: enabled }))
    try {
      await updateWebhook({ data: { projectId, webhookId: webhook.id, patch: { enabled } } })
      toast.success(`${webhook.name} ${enabled ? 'enabled' : 'disabled'}`)
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update the webhook'))
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
      toast.success('Test event queued', {
        description: 'It is sent within a few seconds.',
        action: {
          label: 'View deliveries',
          onClick: () =>
            void navigate({
              to: '/app/$projectSlug/settings/webhooks/$webhookId',
              params: { projectSlug, webhookId: webhook.id },
            }),
        },
      })
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error, 'Could not send the test event'))
    }
  }

  if (webhooks.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WebhookIcon />
          </EmptyMedia>
          <EmptyTitle>No webhooks yet</EmptyTitle>
          <EmptyDescription>
            A webhook sends a signed HTTP request to your server whenever something changes in this
            project: a flag is toggled, a scheduled change runs, a segment is edited. Use it to post
            to chat, trigger a deploy check or keep another system in sync.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <HintedButton onClick={onAdd} disabledReason={reason}>
            Add webhook
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
                          Disabled
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
                            Last delivery: <span className="font-mono">{last.eventType}</span>,{' '}
                            {last.status === 'success' ? 'delivered' : last.status}
                            {last.lastStatusCode ? ` (HTTP ${last.lastStatusCode})` : ''},{' '}
                            {formatDelta(last.createdAt)}
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
                        <Switch checked={enabled} disabled aria-label={`Enable ${webhook.name}`} />
                      </DisabledHint>
                    ) : (
                      <Switch
                        checked={enabled}
                        onCheckedChange={(checked) => void setEnabled(webhook, checked)}
                        aria-label={`Enable ${webhook.name}`}
                      />
                    )}
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${webhook.name}`}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Actions</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link
                            to="/app/$projectSlug/settings/webhooks/$webhookId"
                            params={{ projectSlug, webhookId: webhook.id }}
                          >
                            <HistoryIcon /> Deliveries
                          </Link>
                        </DropdownMenuItem>
                        {isOwner ? (
                          <>
                            <DropdownMenuItem onClick={() => onEdit(webhook)}>
                              <PencilIcon /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!enabled}
                              onClick={() => void sendTest(webhook)}
                            >
                              <SendIcon /> Send test event
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setRotating(webhook)}>
                              <KeyRoundIcon /> Rotate secret
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleting(webhook)}
                            >
                              <Trash2Icon /> Delete
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
        title={`Rotate the secret of ${rotating?.name ?? 'this webhook'}?`}
        description="Halyard generates a new signing secret and shows it once. Requests are signed with the new secret right away, so your endpoint rejects them until you update it."
        confirmLabel="Rotate secret"
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
        title={`Delete ${deleting?.name ?? 'this webhook'}?`}
        description="It stops receiving events and its delivery history is deleted. This cannot be undone."
        confirmLabel="Delete webhook"
        onConfirm={async () => {
          if (!deleting) return
          await deleteWebhook({ data: { projectId, webhookId: deleting.id } })
          toast.success(`Webhook "${deleting.name}" deleted`)
          await router.invalidate()
        }}
      />
    </MotionConfig>
  )
}
