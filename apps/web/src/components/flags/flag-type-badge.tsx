import type { FlagType } from '@halyard/engine'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const TYPE_INFO: Record<FlagType, { short: string; full: string }> = {
  boolean: { short: 'bool', full: 'Boolean' },
  string: { short: 'str', full: 'String' },
  number: { short: 'num', full: 'Number' },
  json: { short: 'json', full: 'JSON' },
}

export interface FlagTypeBadgeProps {
  type: FlagType
  className?: string
}

/** Tiny mono badge: `bool`, `str`, `num` or `json`, with the full type name in a tooltip. */
export function FlagTypeBadge({ type, className }: FlagTypeBadgeProps) {
  const info = TYPE_INFO[type]
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              'h-[18px] rounded px-1.5 font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-wide',
              className,
            )}
          >
            <span aria-hidden="true">{info.short}</span>
            <span className="sr-only">{info.full} flag</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{info.full} flag</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
