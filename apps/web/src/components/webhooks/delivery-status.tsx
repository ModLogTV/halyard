import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type DeliveryStatus = 'pending' | 'success' | 'failed'

const LABELS: Record<DeliveryStatus, string> = {
  pending: 'Pending',
  success: 'Delivered',
  failed: 'Failed',
}

export function DeliveryStatusBadge({
  status,
  className,
}: {
  status: DeliveryStatus
  className?: string
}) {
  return (
    <Badge
      variant={status === 'failed' ? 'destructive' : 'outline'}
      className={cn(
        status === 'success' && 'border-transparent bg-on-soft text-foreground',
        className,
      )}
    >
      {LABELS[status]}
    </Badge>
  )
}

/** Small coloured dot for a delivery status, with a screen reader label. */
export function DeliveryDot({ status, className }: { status: DeliveryStatus; className?: string }) {
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
      <span className="sr-only">Last delivery {LABELS[status].toLowerCase()}</span>
    </>
  )
}
