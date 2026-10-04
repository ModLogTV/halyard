import type { FlagType } from '@modlogtv/halyard-engine'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface FlagTypeBadgeProps {
  type: FlagType
  className?: string
}

/** Tiny mono badge: `bool`, `str`, `num` or `json`, with the full type name in a tooltip. */
export function FlagTypeBadge({ type, className }: FlagTypeBadgeProps) {
  const { t } = useTranslation(['flags', 'common'])
  const short = t(`flagTypeBadge.short.${type}`)
  const full = t(`common:flagTypes.${type}Flag`)
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
            <span aria-hidden="true">{short}</span>
            <span className="sr-only">{full}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{full}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
