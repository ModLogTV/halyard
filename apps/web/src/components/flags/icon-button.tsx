import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'aria-label'> {
  /** Accessible name. Also the tooltip text unless `tooltip` is given. */
  label: string
  tooltip?: ReactNode
  /**
   * Keeps the button focusable (so the tooltip works) but inert, and explains why in the
   * tooltip and accessible name. Use for actions that are unavailable for a reason worth stating.
   */
  disabledReason?: string
}

/** Icon-only ghost button. Always has a tooltip and an `aria-label`. */
export function IconButton({
  label,
  tooltip,
  disabledReason,
  className,
  onClick,
  children,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: IconButtonProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            {...props}
            aria-label={disabledReason ? `${label} (unavailable: ${disabledReason})` : label}
            aria-disabled={disabledReason ? true : undefined}
            className={cn('text-muted-foreground', disabledReason && 'opacity-50', className)}
            onClick={disabledReason ? (event) => event.preventDefault() : onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{disabledReason ?? tooltip ?? label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
