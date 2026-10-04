import { TriangleAlertIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EnvironmentLike } from '@/components/env/env-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'
import { pluralize } from '@/lib/format'
import { type SegmentUsageItem, UsageList } from './segment-usages'

/**
 * Confirms deleting a segment. While rules still reference it the dialog lists them and the
 * delete button is disabled; the server enforces the same rule.
 */
export function DeleteSegmentDialog({
  open,
  onOpenChange,
  segmentKey,
  usages,
  projectSlug,
  environments,
  pending,
  error,
  onConfirm,
  trigger,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  segmentKey: string
  usages: SegmentUsageItem[]
  projectSlug: string
  environments: EnvironmentLike[]
  pending?: boolean
  error?: string | null
  onConfirm: () => void
  trigger?: ReactNode
}) {
  const inUse = usages.length > 0
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {inUse ? `Segment "${segmentKey}" is still in use` : `Delete segment "${segmentKey}"?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {inUse
              ? `${pluralize(usages.length, 'flag rule')} reference this segment. Remove the segment condition from these rules first, then delete it.`
              : 'This cannot be undone. No flag rules reference this segment.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {inUse ? (
          <div className="max-h-64 overflow-y-auto rounded-md border p-3">
            <UsageList usages={usages} projectSlug={projectSlug} environments={environments} />
          </div>
        ) : null}
        {error && !inUse ? (
          <p className="flex items-center gap-2 text-destructive text-sm" role="alert">
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{inUse ? 'Close' : 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || inUse}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? <Spinner /> : null}
            Delete segment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
