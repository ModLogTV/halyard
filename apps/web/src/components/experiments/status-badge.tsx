import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ExperimentStatus } from './utils'

const LABELS: Record<ExperimentStatus, string> = {
  running: 'Running',
  draft: 'Draft',
  stopped: 'Stopped',
}

/** Running is green with a pulsing dot (static under reduced motion), draft is muted, stopped is an outline. */
export function ExperimentStatusBadge({
  status,
  className,
}: {
  status: ExperimentStatus
  className?: string
}) {
  if (status === 'running') {
    return (
      <Badge className={cn('gap-1.5 border-on/30 bg-on-soft text-foreground', className)}>
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex size-full rounded-full bg-on opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-on" />
        </span>
        {LABELS.running}
      </Badge>
    )
  }
  if (status === 'draft') {
    return (
      <Badge variant="secondary" className={cn('text-muted-foreground', className)}>
        {LABELS.draft}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cn('text-muted-foreground', className)}>
      {LABELS.stopped}
    </Badge>
  )
}
