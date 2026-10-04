import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type DeliveryStatus = 'pending' | 'success' | 'failed'

export function DeliveryStatusBadge({
  status,
  className,
}: {
  status: DeliveryStatus
  className?: string
}) {
  const { t } = useTranslation('settings')
  return (
    <Badge
      variant={status === 'failed' ? 'destructive' : 'outline'}
      className={cn(
        status === 'success' && 'border-transparent bg-on-soft text-foreground',
        className,
      )}
    >
      {t(`webhooks.deliveries.status.${status}`)}
    </Badge>
  )
}

/** Small coloured dot for a delivery status, with a screen reader label. */
export function DeliveryDot({ status, className }: { status: DeliveryStatus; className?: string }) {
  const { t } = useTranslation('settings')
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-2 shrink-0 rounded-full',
          status === 'success' && 'bg-on',
          status === 'failed' && 'bg-destructive',
          status === 'pending' && 'bg-warning',
          className,
        )}
      />
      <span className="sr-only">
        {t('webhooks.deliveries.lastDeliveryStatus', {
          status: t(`webhooks.deliveries.statusInline.${status}`),
        })}
      </span>
    </>
  )
}
