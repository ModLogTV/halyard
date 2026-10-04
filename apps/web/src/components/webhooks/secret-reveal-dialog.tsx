import { TriangleAlertIcon } from 'lucide-react'
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
  return (
    <Dialog open={revealed !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        {revealed ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {revealed.kind === 'created' ? 'Webhook created' : 'Secret rotated'}
              </DialogTitle>
              <DialogDescription>
                {revealed.kind === 'created'
                  ? `${revealed.name} is enabled and will receive the events you chose.`
                  : `The previous secret of ${revealed.name} no longer works. Update your endpoint.`}
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>Copy the signing secret now</AlertTitle>
              <AlertDescription>
                It is shown only once. If you lose it, rotate the secret to get a new one.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
                <span className="sr-only">Signing secret: </span>
                {revealed.secret}
              </code>
              <CopyButton value={revealed.secret} label="Copy secret" />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-medium text-sm">Request headers</h3>
              <HeadersTable />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-medium text-sm">Verify the signature (Node.js)</h3>
              <p className="text-muted-foreground text-sm">
                The signature is <code className="font-mono text-xs">{SIGNATURE_FORMULA}</code>.
                Reject requests older than 5 minutes.
              </p>
              <VerifySnippet />
            </div>
            <DialogFooter>
              <Button onClick={onClose}>I have saved the secret</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
