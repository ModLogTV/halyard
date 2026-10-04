import { TriangleAlertIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { EnvironmentLike } from '@/components/env/env-badge'
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
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * On/off switch for a flag in one environment. Production environments ask for
 * confirmation and are visually distinct; other environments toggle immediately.
 */
export function EnvToggle({
  flagKey,
  environment,
  enabled,
  onChange,
  disabled,
  disabledReason,
  size = 'default',
}: {
  flagKey: string
  environment: EnvironmentLike
  enabled: boolean
  onChange: (enabled: boolean) => void | Promise<void>
  disabled?: boolean
  disabledReason?: string
  size?: 'sm' | 'default'
}) {
  const { t } = useTranslation(['flags', 'common'])
  const [confirming, setConfirming] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const id = useId()
  const label = t(enabled ? 'envToggle.label.disable' : 'envToggle.label.enable', {
    flagKey,
    environment: environment.name,
  })

  async function apply(next: boolean) {
    setPending(true)
    try {
      await onChange(next)
    } finally {
      setPending(false)
    }
  }

  const control = (
    <span className="inline-flex items-center" style={envStyle(environment)}>
      <Switch
        id={id}
        checked={enabled}
        disabled={disabled || pending}
        aria-label={label}
        onCheckedChange={(next) => {
          if (environment.isProduction) setConfirming(next)
          else void apply(next)
        }}
        className={cn(
          'data-[state=checked]:bg-on',
          size === 'sm' && 'h-4 w-7 [&_[data-slot=switch-thumb]]:size-3',
          environment.isProduction &&
            'ring-2 ring-(--env-color)/30 ring-offset-1 ring-offset-background',
        )}
      />
    </span>
  )

  return (
    <>
      {disabled && disabledReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{control}</span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{control}</TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent style={envStyle(environment)}>
          <HazardBand />
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-5 text-(--env-color)" />
              {confirming
                ? t('envToggle.confirm.enableTitle')
                : t('envToggle.confirm.disableTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  <Trans
                    t={t}
                    i18nKey={confirming ? 'envToggle.confirm.bodyOn' : 'envToggle.confirm.bodyOff'}
                    values={{ flagKey }}
                    components={[
                      <span key="key" className="font-mono text-foreground" />,
                      <strong key="state" />,
                      <EnvBadge key="env" env={environment} className="align-middle" />,
                    ]}
                  />
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = confirming
                setConfirming(null)
                if (next !== null) void apply(next)
              }}
            >
              {confirming
                ? t('envToggle.confirm.enableAction')
                : t('envToggle.confirm.disableAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
