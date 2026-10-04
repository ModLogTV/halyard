import { useRouter } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnvBadge, envStyle } from '@/components/env/env-badge'
import { HazardBand } from '@/components/env/hazard-band'
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
  const { t } = useTranslation(['experiments', 'common'])
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
        toast.success(t(`actions.toast.${type}`, { key: target.key }))
        setPending(null)
        await onDone?.(type, target)
        await router.invalidate()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t(`actions.failed.${type}`))
        setPending(null)
      } finally {
        setBusy(false)
      }
    },
    [projectId, router, onDone, t],
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
          {type === 'start' && production ? <HazardBand /> : null}
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {type === 'start' && production ? (
                <TriangleAlertIcon className="size-5 text-(--env-color)" />
              ) : null}
              {type === 'start'
                ? t('actions.startTitle')
                : type === 'stop'
                  ? t('actions.stopTitle', { key: target.key })
                  : t('actions.deleteTitle', { key: target.key })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {type === 'start' ? (
                <Trans
                  t={t}
                  i18nKey="actions.startBody"
                  values={{ key: target.key }}
                  components={[
                    <span key="key" className="font-mono text-foreground" />,
                    <EnvBadge key="env" env={target.environment} className="align-middle" />,
                  ]}
                />
              ) : type === 'stop' ? (
                t('actions.stopBody')
              ) : (
                <Trans
                  t={t}
                  i18nKey="actions.deleteBody"
                  values={{ key: target.key }}
                  components={[<span key="key" className="font-mono text-foreground" />]}
                />
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant={type === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void run(pending.type, pending.target)
              }}
            >
              {t(`actions.confirm.${pending.type}`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  )

  return { request, dialogs }
}
