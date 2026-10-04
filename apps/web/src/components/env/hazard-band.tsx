import { cn } from '@/lib/utils'

/**
 * Thin hazard stripe across the top edge of a dialog that changes production.
 * Sized to the dialog content's 16px padding and 12px radius; place it as the
 * first child of `DialogContent` or `AlertDialogContent`.
 */
export function HazardBand({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('hazard-stripes -mx-4 -mt-4 h-2 shrink-0 rounded-t-xl', className)}
    />
  )
}
