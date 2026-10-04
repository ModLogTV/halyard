import { ChevronRightIcon, RefreshCwIcon, RotateCcwIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatDelta } from '@/components/schedules/utils'
import { errorMessage } from '@/components/settings/form-utils'
import { IconButton } from '@/components/settings/hinted-button'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { listWebhookDeliveries, redeliverWebhook } from '@/server/functions/webhooks'
import type { WebhookDelivery, WebhookDeliveryPage } from '@/server/services/webhooks'
import { DeliveryStatusBadge } from './delivery-status'

/** Matches the dispatcher: a delivery fails for good after this many attempts. */
export const MAX_ATTEMPTS = 8
const REFRESH_MS = 15_000
const PAGE_SIZE = 50

/** Newest page first; keeps older, already loaded rows that the fresh page does not cover. */
function mergeFirstPage(current: WebhookDelivery[], fresh: WebhookDeliveryPage) {
  if (fresh.nextCursor === null) return fresh.items
  const oldest = fresh.items[fresh.items.length - 1]
  if (!oldest) return current
  const cutoff = new Date(oldest.createdAt).getTime()
  const older = current.filter((d) => new Date(d.createdAt).getTime() < cutoff)
  return [...fresh.items, ...older]
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export interface DeliveryTableProps {
  projectId: string
  webhookId: string
  initial: WebhookDeliveryPage
  canManage: boolean
  /** Redelivery is refused for disabled webhooks. */
  webhookEnabled: boolean
  /** Bump to refetch, e.g. after a test event was queued. */
  refreshKey?: number
}

export function DeliveryTable({
  projectId,
  webhookId,
  initial,
  canManage,
  webhookEnabled,
  refreshKey = 0,
}: DeliveryTableProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [items, setItems] = useState(initial.items)
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [resending, setResending] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(() => new Date())
  const hasPending = items.some((d) => d.status === 'pending')

  const refresh = useCallback(
    async (silent = true) => {
      setRefreshing(true)
      try {
        const page = await listWebhookDeliveries({
          data: { projectId, webhookId, limit: PAGE_SIZE },
        })
        setItems((current) => {
          // Only trust the new cursor while nothing beyond the first page is loaded.
          if (current.length <= PAGE_SIZE || page.nextCursor === null) {
            setNextCursor(page.nextCursor)
          }
          return mergeFirstPage(current, page)
        })
        setNow(new Date())
      } catch (error) {
        if (!silent) toast.error(errorMessage(error, t('webhooks.deliveries.refreshFailed')))
      } finally {
        setRefreshing(false)
      }
    },
    [projectId, webhookId, t],
  )

  // Reflect a fresh route load (for example after router.invalidate()).
  useEffect(() => {
    setItems(initial.items)
    setNextCursor(initial.nextCursor)
  }, [initial])

  useEffect(() => {
    if (refreshKey > 0) void refresh()
  }, [refreshKey, refresh])

  useEffect(() => {
    if (!hasPending) return
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [hasPending, refresh])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await listWebhookDeliveries({
        data: { projectId, webhookId, cursor: nextCursor, limit: PAGE_SIZE },
      })
      setItems((current) => {
        const known = new Set(current.map((d) => d.id))
        return [...current, ...page.items.filter((d) => !known.has(d.id))]
      })
      setNextCursor(page.nextCursor)
    } catch (error) {
      toast.error(errorMessage(error, t('webhooks.deliveries.loadMoreFailed')))
    } finally {
      setLoadingMore(false)
    }
  }

  async function resend(delivery: WebhookDelivery) {
    setResending((prev) => new Set(prev).add(delivery.id))
    try {
      await redeliverWebhook({ data: { projectId, deliveryId: delivery.id } })
      toast.success(t('webhooks.deliveries.resent'))
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('webhooks.deliveries.resendFailed')))
    } finally {
      setResending((prev) => {
        const next = new Set(prev)
        next.delete(delivery.id)
        return next
      })
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (items.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RefreshCwIcon />
          </EmptyMedia>
          <EmptyTitle>{t('webhooks.deliveries.empty.title')}</EmptyTitle>
          <EmptyDescription>{t('webhooks.deliveries.empty.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const resendReason = !canManage
    ? t('shared.ownerOnly')
    : webhookEnabled
      ? undefined
      : t('webhooks.deliveries.enableBeforeResend')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
        <span aria-live="polite">
          {hasPending ? t('webhooks.deliveries.refreshing') : t('webhooks.deliveries.settled')}
        </span>
        <Button variant="ghost" size="xs" onClick={() => void refresh(false)} disabled={refreshing}>
          {refreshing ? <Spinner /> : <RefreshCwIcon />} {t('common:actions.refresh')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">{t('webhooks.deliveries.details')}</span>
              </TableHead>
              <TableHead>{t('common:labels.time')}</TableHead>
              <TableHead>{t('common:labels.event')}</TableHead>
              <TableHead>{t('common:labels.status')}</TableHead>
              <TableHead className="text-right">{t('webhooks.deliveries.attempts')}</TableHead>
              <TableHead>{t('webhooks.deliveries.http')}</TableHead>
              <TableHead>{t('webhooks.deliveries.nextAttempt')}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t('common:labels.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((delivery) => (
              <DeliveryRows
                key={delivery.id}
                delivery={delivery}
                open={expanded.has(delivery.id)}
                now={now}
                canManage={canManage}
                resendReason={resendReason}
                resending={resending.has(delivery.id)}
                onToggle={() => toggle(delivery.id)}
                onResend={() => void resend(delivery)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? <Spinner /> : null}
            {t('webhooks.deliveries.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function DeliveryRows({
  delivery,
  open,
  now,
  canManage,
  resendReason,
  resending,
  onToggle,
  onResend,
}: {
  delivery: WebhookDelivery
  open: boolean
  now: Date
  canManage: boolean
  resendReason: string | undefined
  resending: boolean
  onToggle: () => void
  onResend: () => void
}) {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const created = new Date(delivery.createdAt)
  const detailId = `delivery-${delivery.id}`
  return (
    <>
      <TableRow data-state={open ? 'selected' : undefined}>
        <TableCell>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={
              open
                ? t('webhooks.deliveries.hideDetails', { event: delivery.eventType })
                : t('webhooks.deliveries.showDetails', { event: delivery.eventType })
            }
            onClick={onToggle}
          >
            <ChevronRightIcon
              className={cn(
                'transition-transform motion-reduce:transition-none',
                open && 'rotate-90',
              )}
            />
          </Button>
        </TableCell>
        <TableCell className="whitespace-nowrap text-sm">
          <time dateTime={created.toISOString()} title={formatDateTime(created, i18n.language)}>
            {formatRelativeTime(created, { now, locale: i18n.language })}
          </time>
        </TableCell>
        <TableCell className="font-mono text-xs">{delivery.eventType}</TableCell>
        <TableCell>
          <DeliveryStatusBadge status={delivery.status} />
        </TableCell>
        <TableCell className="tabular text-right text-sm">
          {delivery.attempts}/{MAX_ATTEMPTS}
        </TableCell>
        <TableCell className="tabular text-sm">
          {delivery.lastStatusCode ?? <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
          {delivery.status === 'pending' ? (
            <time
              dateTime={new Date(delivery.nextAttemptAt).toISOString()}
              title={formatDateTime(delivery.nextAttemptAt, i18n.language)}
            >
              {formatDelta(delivery.nextAttemptAt, now, i18n.language)}
            </time>
          ) : (
            '—'
          )}
        </TableCell>
        <TableCell className="text-right">
          <IconButton
            label={t('webhooks.deliveries.resend', { event: delivery.eventType })}
            disabledReason={resendReason}
            disabled={resending}
            onClick={onResend}
          >
            {resending ? <Spinner /> : <RotateCcwIcon />}
          </IconButton>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow id={detailId} className="bg-muted/30 hover:bg-muted/30">
          <TableCell />
          <TableCell colSpan={7} className="whitespace-normal py-3">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <h4 className="font-medium text-xs">{t('webhooks.deliveries.requestPayload')}</h4>
                <pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 font-mono text-xs">
                  {prettyJson(delivery.payload)}
                </pre>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h4 className="font-medium text-xs">{t('webhooks.deliveries.latestResponse')}</h4>
                {delivery.lastError ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-xs">
                    {delivery.lastError}
                  </p>
                ) : null}
                {delivery.lastResponseBody ? (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-background p-3 font-mono text-xs">
                    {delivery.lastResponseBody}
                  </pre>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {delivery.attempts === 0
                      ? t('webhooks.deliveries.notAttempted')
                      : canManage
                        ? t('webhooks.deliveries.noBody')
                        : t('webhooks.deliveries.ownersOnly')}
                  </p>
                )}
                {delivery.deliveredAt ? (
                  <p className="text-muted-foreground text-xs">
                    {t('webhooks.deliveries.deliveredAt', {
                      time: formatDateTime(delivery.deliveredAt, i18n.language),
                    })}
                  </p>
                ) : null}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
