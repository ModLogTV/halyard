import { useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
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
import { ROLE_INFO, ROLE_ORDER } from './roles'

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
      toast.success(`Invitation sent to ${invitation.email}`)
      await router.invalidate()
      onDone()
    } catch (error) {
      setServerError(errorMessage(error, 'Could not send the invitation'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>Invite member</DialogTitle>
        <DialogDescription>
          They will see the invitation after signing in with this email.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-5">
        <Field data-invalid={showEmail ? true : undefined}>
          <FieldLabel htmlFor="invite-email">Email</FieldLabel>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@example.com"
            autoComplete="off"
            aria-invalid={showEmail ? true : undefined}
            autoFocus
          />
          <FieldError>{showEmail ? 'Enter a valid email address' : undefined}</FieldError>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Role</FieldLegend>
          <RadioGroup value={role} onValueChange={(next) => setRole(next as ProjectRole)}>
            {ROLE_ORDER.map((value) => (
              <FieldLabel key={value} htmlFor={`invite-role-${value}`}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{ROLE_INFO[value].label}</FieldTitle>
                    <FieldDescription>{ROLE_INFO[value].description}</FieldDescription>
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
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Send invitation
        </Button>
      </DialogFooter>
    </form>
  )
}
