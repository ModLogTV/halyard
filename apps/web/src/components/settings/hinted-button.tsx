import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type ButtonProps = ComponentProps<typeof Button>

/**
 * Disabled buttons do not fire pointer events, so the tooltip hangs off a focusable
 * wrapper. That keeps the explanation reachable with the mouse and the keyboard.
 */
export function DisabledHint({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so the tooltip works for a disabled control
          tabIndex={0}
          className="inline-flex rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

/** Icon-only button with a tooltip and an accessible name. */
export function IconButton({
  label,
  disabledReason,
  variant = 'ghost',
  size = 'icon-sm',
  children,
  ...props
}: Omit<ButtonProps, 'aria-label'> & { label: string; disabledReason?: string }) {
  if (disabledReason) {
    return (
      <DisabledHint reason={disabledReason}>
        <Button
          {...props}
          type="button"
          variant={variant}
          size={size}
          aria-label={label}
          disabled
          tabIndex={-1}
        >
          {children}
        </Button>
      </DisabledHint>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props} type="button" variant={variant} size={size} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Button with a visible label that explains why it is disabled when `disabledReason` is set. */
export function HintedButton({
  disabledReason,
  children,
  ...props
}: ButtonProps & { disabledReason?: string }) {
  if (disabledReason) {
    return (
      <DisabledHint reason={disabledReason}>
        <Button {...props} disabled tabIndex={-1}>
          {children}
        </Button>
      </DisabledHint>
    )
  }
  return <Button {...props}>{children}</Button>
}
