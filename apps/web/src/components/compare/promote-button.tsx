import { ArrowUpFromLineIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** "Promote" button that stays focusable (for its tooltip) but inert when `disabledReason` is set. */
export function PromoteButton({
  onClick,
  disabledReason,
  label,
  className,
}: {
  onClick: () => void
  disabledReason?: string
  /** Accessible name, e.g. "Promote checkout.new-flow from Staging to Production". */
  label: string
  className?: string
}) {
  const { t } = useTranslation('compare')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label={
            disabledReason
              ? t('promote.unavailableLabel', { label, reason: disabledReason })
              : label
          }
          aria-disabled={disabledReason ? true : undefined}
          className={cn(disabledReason && 'opacity-50', className)}
          onClick={(event) => {
            event.stopPropagation()
            if (!disabledReason) onClick()
          }}
        >
          <ArrowUpFromLineIcon /> {t('promote.button')}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{disabledReason ?? label}</TooltipContent>
    </Tooltip>
  )
}
