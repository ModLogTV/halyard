import { useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { EnvBadge } from '@/components/env/env-badge'
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
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { createEnvironment, updateEnvironment } from '@/server/functions/environments'
import { nameSchema } from '@/server/schemas/common'
import { colorSchema, environmentKeySchema } from '@/server/schemas/environments'
import type { Environment } from '@/server/services/environments'
import { ColorField, DEFAULT_ENVIRONMENT_COLOR } from './color-field'
import { errorMessage, firstError } from './form-utils'

/** Turns a display name into a key accepted by the server (`^[a-z0-9][a-z0-9-_]*$`). */
export function slugifyEnvironmentKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 64)
}

export function EnvironmentDialog({
  projectId,
  environment,
  open,
  onOpenChange,
}: {
  projectId: string
  /** Edit this environment, or create a new one when omitted. */
  environment?: Environment
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <EnvironmentForm
          projectId={projectId}
          environment={environment}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function EnvironmentForm({
  projectId,
  environment,
  onDone,
}: {
  projectId: string
  environment?: Environment
  onDone: () => void
}) {
  const router = useRouter()
  const editing = environment !== undefined
  const [name, setName] = useState(environment?.name ?? '')
  const [key, setKey] = useState(environment?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(false)
  const [color, setColor] = useState(environment?.color ?? DEFAULT_ENVIRONMENT_COLOR)
  const [isProduction, setIsProduction] = useState(environment?.isProduction ?? false)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const nameError = firstError(nameSchema, name)
  const keyError = editing ? undefined : firstError(environmentKeySchema, key)
  const colorError = firstError(colorSchema, color)
  const showName = submitted ? nameError : undefined
  const showKey = keyTouched || submitted ? keyError : undefined
  const showColor = submitted || color.length === 7 ? colorError : undefined

  const unchanged =
    editing &&
    name.trim() === environment.name &&
    color.toLowerCase() === environment.color.toLowerCase() &&
    isProduction === environment.isProduction

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (nameError || keyError || colorError) return
    setPending(true)
    setServerError(null)
    try {
      if (editing) {
        await updateEnvironment({
          data: {
            projectId,
            environmentId: environment.id,
            patch: {
              ...(name.trim() !== environment.name && { name: name.trim() }),
              ...(color.toLowerCase() !== environment.color.toLowerCase() && {
                color: color.toLowerCase(),
              }),
              ...(isProduction !== environment.isProduction && { isProduction }),
            },
          },
        })
        toast.success(`Environment "${name.trim()}" updated`)
      } else {
        await createEnvironment({
          data: { projectId, key, name: name.trim(), color: color.toLowerCase(), isProduction },
        })
        toast.success(`Environment "${name.trim()}" created`)
      }
      await router.invalidate()
      onDone()
    } catch (error) {
      setServerError(errorMessage(error, 'Could not save the environment'))
    } finally {
      setPending(false)
    }
  }

  const preview = {
    key: key || 'key',
    name: name.trim() || 'Environment',
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ENVIRONMENT_COLOR,
    isProduction,
  }

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${environment.name}` : 'Add environment'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'The key identifies the environment in the API and the CLI, so it cannot be changed.'
            : 'Every flag gets a disabled configuration in the new environment.'}
        </DialogDescription>
      </DialogHeader>

      <div
        className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5"
        aria-live="polite"
      >
        <span className="text-xs text-muted-foreground">Preview</span>
        <EnvBadge env={preview} />
      </div>

      <FieldGroup className="gap-5">
        <Field data-invalid={showName ? true : undefined}>
          <FieldLabel htmlFor="env-name">Name</FieldLabel>
          <Input
            id="env-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (!editing && !keyTouched) setKey(slugifyEnvironmentKey(event.target.value))
            }}
            placeholder="QA"
            aria-invalid={showName ? true : undefined}
            autoFocus
            autoComplete="off"
          />
          <FieldError>{showName}</FieldError>
        </Field>

        <Field data-invalid={showKey ? true : undefined}>
          <FieldLabel htmlFor="env-key">Key</FieldLabel>
          <Input
            id="env-key"
            value={key}
            onChange={(event) => {
              setKeyTouched(true)
              setKey(event.target.value)
            }}
            placeholder="qa"
            className="font-mono"
            disabled={editing}
            aria-invalid={showKey ? true : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {showKey ? (
            <FieldError>{showKey}</FieldError>
          ) : editing ? null : (
            <FieldDescription>
              Lowercase letters, digits, dashes and underscores. Generated from the name.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={showColor ? true : undefined}>
          <FieldLabel htmlFor="env-color">Colour</FieldLabel>
          <ColorField id="env-color" value={color} onChange={setColor} invalid={!!showColor} />
          <FieldError>{showColor}</FieldError>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="env-production">Production environment</FieldLabel>
            <FieldDescription>
              Production environments ask for confirmation before changes and are marked with hazard
              stripes.
            </FieldDescription>
          </FieldContent>
          <Switch id="env-production" checked={isProduction} onCheckedChange={setIsProduction} />
        </Field>

        {serverError ? <FieldError>{serverError}</FieldError> : null}
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || unchanged}>
          {pending ? <Spinner /> : null}
          {editing ? 'Save changes' : 'Add environment'}
        </Button>
      </DialogFooter>
    </form>
  )
}
