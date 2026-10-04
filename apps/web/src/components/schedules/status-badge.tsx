import { CircleAlertIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ScheduleStatus } from './utils'

const LABELS: Record<ScheduleStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/** Status of a scheduled change. Failed changes show the error in a tooltip. */
export function ScheduleStatusBadge({
  status,
  error,
  className,
}: {
  status: ScheduleStatus
  error?: string | null
  className?: string
}) {
  const badge = (
    <Badge
      variant={status === 'failed' ? 'destructive' : 'outline'}
      className={cn(
        status === 'completed' && 'border-transparent bg-on-soft text-foreground',
        status === 'cancelled' && 'bg-muted text-muted-foreground',
        status === 'running' && 'bg-info-soft',
        className,
      )}
      tabIndex={status === 'failed' && error ? 0 : undefined}
    >
      {status === 'failed' ? <CircleAlertIcon /> : null}
      {LABELS[status]}
    </Badge>
  )
  if (status !== 'failed' || !error) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{error}</TooltipContent>
    </Tooltip>
  )
}
