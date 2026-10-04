import { TriangleAlertIcon } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from './form-utils'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Runs when the user confirms. Throw to keep the dialog open and show the error. */
  onConfirm: () => Promise<void>
  /** Ask the user to type this text before the confirm button is enabled. */
  requireText?: string
  destructive?: boolean
}

/** AlertDialog for destructive actions, with an async confirm and an optional typed guard. */
export function ConfirmDialog({ open, onOpenChange, ...props }: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <ConfirmBody onOpenChange={onOpenChange} {...props} />
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ConfirmBody({
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  requireText,
  destructive = true,
}: Omit<ConfirmDialogProps, 'open'>) {
  const { t } = useTranslation(['settings', 'common'])
  const [pending, setPending] = useState(false)
  const [typed, setTyped] = useState('')
  const armed = requireText === undefined || typed === requireText

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!armed || pending) return
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error, t('common:errors.generic')))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="contents">
      <AlertDialogHeader>
        {destructive ? (
          <AlertDialogMedia className="size-12 bg-destructive/10 text-destructive *:[svg:not([class*='size-'])]:size-6">
            <TriangleAlertIcon />
          </AlertDialogMedia>
        ) : null}
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div>{description}</div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      {requireText !== undefined ? (
        <Field>
          <FieldLabel htmlFor="confirm-text">
            <Trans
              t={t}
              i18nKey="shared.typeToConfirm"
              values={{ value: requireText }}
              components={[<span key="value" className="font-mono font-semibold" />]}
            />
          </FieldLabel>
          <Input
            id="confirm-text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="font-mono"
            autoFocus
          />
          <FieldDescription>{t('common:confirm.deleteBody')}</FieldDescription>
        </Field>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel type="button" disabled={pending}>
          {cancelLabel ?? t('common:actions.cancel')}
        </AlertDialogCancel>
        <Button
          type="submit"
          variant={destructive ? 'destructive' : 'default'}
          disabled={!armed || pending}
        >
          {pending ? <Spinner /> : null}
          {confirmLabel}
        </Button>
      </AlertDialogFooter>
    </form>
  )
}
