import { TriangleAlertIcon } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { CopyButton } from '@/components/settings/copy-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { HeadersTable, SIGNATURE_FORMULA, VerifySnippet } from './verification-guide'

export interface RevealedSecret {
  kind: 'created' | 'rotated'
  name: string
  secret: string
}

/** Shows a signing secret exactly once, together with what is needed to verify requests. */
export function SecretRevealDialog({
  revealed,
  onClose,
}: {
  revealed: RevealedSecret | null
  onClose: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Dialog open={revealed !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        {revealed ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {revealed.kind === 'created'
                  ? t('webhooks.reveal.createdTitle')
                  : t('webhooks.reveal.rotatedTitle')}
              </DialogTitle>
              <DialogDescription>
                {revealed.kind === 'created'
                  ? t('webhooks.reveal.createdDescription', { name: revealed.name })
                  : t('webhooks.reveal.rotatedDescription', { name: revealed.name })}
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>{t('webhooks.reveal.copyNowTitle')}</AlertTitle>
              <AlertDescription>{t('webhooks.reveal.copyNowDescription')}</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
                <span className="sr-only">{t('webhooks.reveal.secretSr')} </span>
                {revealed.secret}
              </code>
              <CopyButton value={revealed.secret} label={t('webhooks.reveal.copySecret')} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-medium text-sm">{t('webhooks.reveal.headersTitle')}</h3>
              <HeadersTable />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-medium text-sm">{t('webhooks.reveal.verifyTitle')}</h3>
              <p className="text-muted-foreground text-sm">
                <Trans
                  t={t}
                  i18nKey="webhooks.reveal.signatureIs"
                  values={{ formula: SIGNATURE_FORMULA }}
                  components={[<code key="formula" className="font-mono text-xs" />]}
                />
              </p>
              <VerifySnippet />
            </div>
            <DialogFooter>
              <Button onClick={onClose}>{t('webhooks.reveal.done')}</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
