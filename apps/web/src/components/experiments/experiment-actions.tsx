import { useRouter } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { EnvBadge, envStyle } from '@/components/env/env-badge'
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
import { deleteExperiment, startExperiment, stopExperiment } from '@/server/functions/experiments'
import type { EnvironmentOption } from './utils'

export type ExperimentActionType = 'start' | 'stop' | 'delete'

export interface ExperimentActionTarget {
  key: string
  name: string
  environment: EnvironmentOption
}

interface Pending {
  type: ExperimentActionType
  target: ExperimentActionTarget
}

const SUCCESS: Record<ExperimentActionType, string> = {
  start: 'started',
  stop: 'stopped',
  delete: 'deleted',
}

/**
 * Start, stop and delete with the right confirmation. Starting outside production runs
 * straight away; everything else asks first, and production gets the hazard dialog.
 * Render `dialogs` once next to the trigger.
 */
export function useExperimentActions({
  projectId,
  onDone,
}: {
  projectId: string
  onDone?: (type: ExperimentActionType, target: ExperimentActionTarget) => void | Promise<void>
}): {
  request: (type: ExperimentActionType, target: ExperimentActionTarget) => void
  dialogs: ReactNode
} {
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (type: ExperimentActionType, target: ExperimentActionTarget) => {
      setBusy(true)
      try {
        const data = { projectId, experimentKey: target.key }
        if (type === 'start') await startExperiment({ data })
        else if (type === 'stop') await stopExperiment({ data })
        else await deleteExperiment({ data })
        toast.success(`Experiment ${target.key} ${SUCCESS[type]}`)
        setPending(null)
        await onDone?.(type, target)
        await router.invalidate()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not ${type} the experiment`)
        setPending(null)
      } finally {
        setBusy(false)
      }
    },
    [projectId, router, onDone],
  )

  const request = useCallback(
    (type: ExperimentActionType, target: ExperimentActionTarget) => {
      if (type === 'start' && !target.environment.isProduction) {
        void run(type, target)
        return
      }
      setPending({ type, target })
    },
    [run],
  )

  const type = pending?.type
  const target = pending?.target
  const production = Boolean(target?.environment.isProduction)

  const dialogs = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => !open && !busy && setPending(null)}
    >
      {pending && target ? (
        <AlertDialogContent style={envStyle(target.environment)}>
          {type === 'start' && production ? (
            <div className="hazard-stripes -mx-6 -mt-6 mb-2 h-2 rounded-t-lg" aria-hidden="true" />
          ) : null}
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {type === 'start' && production ? (
                <TriangleAlertIcon className="size-5 text-(--env-color)" />
              ) : null}
              {type === 'start'
                ? 'Start this experiment in production?'
                : type === 'stop'
                  ? `Stop ${target.key}?`
                  : `Delete ${target.key}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {type === 'start' ? (
                <>
                  <span className="font-mono text-foreground">{target.key}</span> starts splitting
                  real users in <EnvBadge env={target.environment} className="align-middle" /> right
                  away. Experiments in production affect real users. Allocation, control and
                  conversion event are locked once it runs.
                </>
              ) : type === 'stop' ? (
                'Stopping freezes the results and removes the allocation from evaluation. A stopped experiment cannot be restarted.'
              ) : (
                <>
                  This removes <span className="font-mono text-foreground">{target.key}</span> with
                  all its exposures and conversions. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={type === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void run(pending.type, pending.target)
              }}
            >
              {type === 'start'
                ? 'Start experiment'
                : type === 'stop'
                  ? 'Stop experiment'
                  : 'Delete experiment'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  )

  return { request, dialogs }
}
