import { useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage, firstError } from '@/components/settings/form-utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { createWebhook, updateWebhook } from '@/server/functions/webhooks'
import { webhookSecretSchema, webhookUrlSchema } from '@/server/schemas/webhooks'
import type { Webhook } from '@/server/services/webhooks'
import { EventPicker, type EventTypeInfo } from './event-picker'
import type { RevealedSecret } from './secret-reveal-dialog'

export interface WebhookFormDialogProps {
  projectId: string
  /** The webhook to edit. Without it the dialog creates one. */
  webhook?: Webhook | null
  eventTypes: readonly EventTypeInfo[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (revealed: RevealedSecret) => void
}

export function WebhookFormDialog({
  projectId,
  webhook,
  eventTypes,
  open,
  onOpenChange,
  onCreated,
}: WebhookFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <WebhookForm
          key={webhook?.id ?? 'new'}
          projectId={projectId}
          webhook={webhook ?? null}
          eventTypes={eventTypes}
          onDone={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  )
}

function WebhookForm({
  projectId,
  webhook,
  eventTypes,
  onDone,
  onCreated,
}: {
  projectId: string
  webhook: Webhook | null
  eventTypes: readonly EventTypeInfo[]
  onDone: () => void
  onCreated?: (revealed: RevealedSecret) => void
}) {
  const router = useRouter()
  const editing = webhook !== null
  const [name, setName] = useState(webhook?.name ?? '')
  const [url, setUrl] = useState(webhook?.url ?? '')
  const [events, setEvents] = useState<string[]>(webhook?.events ?? [])
  const [secret, setSecret] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const nameError = name.trim() ? undefined : 'Enter a name'
  const urlError = firstError(webhookUrlSchema, url)
  const eventsError = events.length === 0 ? 'Choose at least one event' : undefined
  const secretError =
    !editing && secret.trim() ? firstError(webhookSecretSchema, secret.trim()) : undefined
  const hasErrors = Boolean(nameError || urlError || eventsError || secretError)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (hasErrors || pending) return
    setPending(true)
    setServerError(null)
    try {
      if (webhook) {
        const patch: { name?: string; url?: string; events?: string[] } = {}
        if (name.trim() !== webhook.name) patch.name = name.trim()
        if (url.trim() !== webhook.url) patch.url = url.trim()
        if (JSON.stringify([...events].sort()) !== JSON.stringify([...webhook.events].sort())) {
          patch.events = events
        }
        if (Object.keys(patch).length > 0) {
          await updateWebhook({ data: { projectId, webhookId: webhook.id, patch } })
          toast.success('Webhook updated')
          await router.invalidate()
        }
        onDone()
      } else {
        const created = await createWebhook({
          data: {
            projectId,
            name: name.trim(),
            url: url.trim(),
            events,
            secret: secret.trim() || undefined,
          },
        })
        await router.invalidate()
        onDone()
        onCreated?.({ kind: 'created', name: created.name, secret: created.secret })
      }
    } catch (error) {
      setServerError(errorMessage(error, 'Could not save the webhook'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${webhook.name}` : 'Add webhook'}</DialogTitle>
        <DialogDescription>
          Halyard sends a signed POST request to the URL whenever one of the chosen events happens.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={submitted && nameError ? true : undefined}>
          <FieldLabel htmlFor="webhook-name">Name</FieldLabel>
          <Input
            id="webhook-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Deploy bot"
            maxLength={100}
            autoComplete="off"
            aria-invalid={(submitted && Boolean(nameError)) || undefined}
            autoFocus
          />
          {submitted && nameError ? <FieldError>{nameError}</FieldError> : null}
        </Field>
        <Field data-invalid={submitted && urlError ? true : undefined}>
          <FieldLabel htmlFor="webhook-url">URL</FieldLabel>
          <Input
            id="webhook-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/halyard-webhook"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-sm"
            aria-invalid={(submitted && Boolean(urlError)) || undefined}
          />
          {submitted && urlError ? (
            <FieldError>{urlError}</FieldError>
          ) : (
            <FieldDescription>Must start with http:// or https://.</FieldDescription>
          )}
        </Field>
        <Field data-invalid={submitted && eventsError ? true : undefined}>
          <FieldLabel>Events</FieldLabel>
          <EventPicker
            value={events}
            onChange={setEvents}
            eventTypes={eventTypes}
            invalid={submitted && Boolean(eventsError)}
          />
          {submitted && eventsError ? <FieldError>{eventsError}</FieldError> : null}
        </Field>
        {editing ? null : (
          <Field data-invalid={secretError ? true : undefined}>
            <FieldLabel htmlFor="webhook-secret">
              Signing secret <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="webhook-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              className="font-mono text-sm"
              placeholder="Leave empty to generate one"
              aria-invalid={Boolean(secretError) || undefined}
            />
            {secretError ? (
              <FieldError>{secretError}</FieldError>
            ) : (
              <FieldDescription>
                Halyard generates a secure random secret and shows it once after you create the
                webhook. Only set your own if your receiver already has one (16 characters or more).
              </FieldDescription>
            )}
          </Field>
        )}
        {serverError ? <FieldError>{serverError}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (submitted && hasErrors)}>
          {pending ? <Spinner /> : null}
          {editing ? 'Save changes' : 'Add webhook'}
        </Button>
      </DialogFooter>
    </form>
  )
}
