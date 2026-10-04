import { useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import type { ProjectRole } from '@/lib/permissions'
import { inviteMember } from '@/server/functions/members'
import { inviteMemberSchema } from '@/server/schemas/members'
import { errorMessage, firstError } from './form-utils'
import { ROLE_ORDER } from './roles'

export function InviteMemberDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <InviteForm projectId={projectId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function InviteForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { t } = useTranslation(['settings', 'common'])
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('editor')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const emailError = firstError(inviteMemberSchema.shape.email, email)
  const showEmail = submitted ? emailError : undefined

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (emailError) return
    setPending(true)
    setServerError(null)
    try {
      const invitation = await inviteMember({ data: { projectId, email, role } })
      toast.success(t('members.inviteDialog.sent', { email: invitation.email }))
      await router.invalidate()
      onDone()
    } catch (error) {
      setServerError(errorMessage(error, t('members.inviteDialog.failed')))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>{t('members.invite')}</DialogTitle>
        <DialogDescription>{t('members.inviteDialog.description')}</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-5">
        <Field data-invalid={showEmail ? true : undefined}>
          <FieldLabel htmlFor="invite-email">{t('common:labels.email')}</FieldLabel>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('members.inviteDialog.emailPlaceholder')}
            autoComplete="off"
            aria-invalid={showEmail ? true : undefined}
            autoFocus
          />
          <FieldError>{showEmail ? t('common:validation.invalidEmail') : undefined}</FieldError>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">{t('common:labels.role')}</FieldLegend>
          <RadioGroup value={role} onValueChange={(next) => setRole(next as ProjectRole)}>
            {ROLE_ORDER.map((value) => (
              <FieldLabel key={value} htmlFor={`invite-role-${value}`}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{t(`common:roles.${value}`)}</FieldTitle>
                    <FieldDescription>{t(`members.roleDescription.${value}`)}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={value} id={`invite-role-${value}`} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
        </FieldSet>

        {serverError ? <FieldError>{serverError}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          {t('common:actions.cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {t('members.inviteDialog.submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}
