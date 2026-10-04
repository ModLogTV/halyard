import { useRouter } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { EnvDot } from '@/components/env/env-badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createManagementKey, createSdkKey } from '@/server/functions/api-keys'
import { createSdkKeySchema } from '@/server/schemas/api-keys'
import type { Environment } from '@/server/services/environments'
import { CopyButton } from './copy-button'
import { errorMessage, firstError } from './form-utils'

export interface RevealedKey {
  kind: 'sdk' | 'management'
  name: string
  key: string
}

const nameSchema = createSdkKeySchema.shape.name

export function CreateSdkKeyDialog({
  projectId,
  environments,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  environments: Environment[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (key: RevealedKey) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <CreateKeyForm
          kind="sdk"
          projectId={projectId}
          environments={environments}
          onDone={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  )
}

export function CreateManagementKeyDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (key: RevealedKey) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <CreateKeyForm
          kind="management"
          projectId={projectId}
          onDone={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateKeyForm({
  kind,
  projectId,
  environments = [],
  onDone,
  onCreated,
}: {
  kind: 'sdk' | 'management'
  projectId: string
  environments?: Environment[]
  onDone: () => void
  onCreated: (key: RevealedKey) => void
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? '')
  const [access, setAccess] = useState<'read' | 'write'>('read')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const nameError = firstError(nameSchema, name)
  const showName = submitted ? nameError : undefined
  const envError = kind === 'sdk' && !environmentId ? 'Choose an environment' : undefined

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (nameError || envError) return
    setPending(true)
    setServerError(null)
    try {
      const trimmed = name.trim()
      const created =
        kind === 'sdk'
          ? await createSdkKey({ data: { projectId, environmentId, name: trimmed } })
          : await createManagementKey({ data: { projectId, name: trimmed, access } })
      await router.invalidate()
      onDone()
      onCreated({ kind, name: trimmed, key: created.key })
    } catch (error) {
      setServerError(errorMessage(error, 'Could not create the key'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>{kind === 'sdk' ? 'Create SDK key' : 'Create management key'}</DialogTitle>
        <DialogDescription>
          {kind === 'sdk'
            ? 'SDK keys evaluate flags for a single environment. Use one per service so you can revoke them independently.'
            : 'Management keys act on the whole project through the CLI and REST API.'}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-5">
        <Field data-invalid={showName ? true : undefined}>
          <FieldLabel htmlFor="key-name">Name</FieldLabel>
          <Input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === 'sdk' ? 'Checkout service' : 'CI pipeline'}
            maxLength={64}
            aria-invalid={showName ? true : undefined}
            autoComplete="off"
            autoFocus
          />
          <FieldError>{showName}</FieldError>
        </Field>

        {kind === 'sdk' ? (
          <Field data-invalid={submitted && envError ? true : undefined}>
            <FieldLabel htmlFor="key-environment">Environment</FieldLabel>
            <Select value={environmentId} onValueChange={setEnvironmentId}>
              <SelectTrigger id="key-environment" className="w-full">
                <SelectValue placeholder="Choose an environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env.id} value={env.id}>
                    <EnvDot env={env} />
                    {env.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {submitted && envError ? (
              <FieldError>{envError}</FieldError>
            ) : (
              <FieldDescription>The key can only read flags of this environment.</FieldDescription>
            )}
          </Field>
        ) : (
          <FieldSet>
            <FieldLegend variant="label">Access</FieldLegend>
            <RadioGroup
              value={access}
              onValueChange={(next) => setAccess(next as 'read' | 'write')}
            >
              <FieldLabel htmlFor="key-access-read">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Read</FieldTitle>
                    <FieldDescription>
                      List and export flags, segments and settings.
                    </FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="read" id="key-access-read" />
                </Field>
              </FieldLabel>
              <FieldLabel htmlFor="key-access-write">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Read and write</FieldTitle>
                    <FieldDescription>Also change flags and import configuration.</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="write" id="key-access-write" />
                </Field>
              </FieldLabel>
            </RadioGroup>
          </FieldSet>
        )}

        {serverError ? <FieldError>{serverError}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Create key
        </Button>
      </DialogFooter>
    </form>
  )
}

function Snippet({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative">
      <section
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable
        tabIndex={0}
        className="max-h-56 overflow-auto rounded-md border bg-muted/50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <pre className="p-3 pr-12 font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      </section>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} label={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  )
}

function sdkSnippets(origin: string, key: string) {
  return {
    curl: `curl -X POST ${origin}/ofrep/v1/evaluate/flags/my-flag \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"context":{"targetingKey":"user-123"}}'`,
    node: `import { OpenFeature } from '@openfeature/server-sdk'
import { OFREPProvider } from '@openfeature/ofrep-provider'

await OpenFeature.setProviderAndWait(
  new OFREPProvider({
    baseUrl: '${origin}',
    headers: [['Authorization', 'Bearer ${key}']],
  }),
)`,
  }
}

/** One-time display of a freshly created key with ready-to-use snippets. */
export function KeyRevealDialog({
  revealed,
  onClose,
}: {
  revealed: RevealedKey | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={revealed !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {revealed ? <RevealBody revealed={revealed} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function RevealBody({ revealed, onClose }: { revealed: RevealedKey; onClose: () => void }) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const sdk = sdkSnippets(origin, revealed.key)
  const cli = `halyard login --url ${origin} --key ${revealed.key}`

  return (
    <>
      <DialogHeader>
        <DialogTitle>Copy your new key</DialogTitle>
        <DialogDescription>
          {revealed.kind === 'sdk' ? 'SDK key' : 'Management key'} "{revealed.name}" is ready.
        </DialogDescription>
      </DialogHeader>

      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>This key will not be shown again</AlertTitle>
        <AlertDescription>
          Store it in your secrets manager now. If you lose it, revoke it and create a new one.
        </AlertDescription>
      </Alert>

      <Field>
        <FieldLabel htmlFor="revealed-key">Key</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="revealed-key"
            readOnly
            value={revealed.key}
            className="font-mono"
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyButton value={revealed.key} />
        </div>
      </Field>

      {revealed.kind === 'sdk' ? (
        <Tabs defaultValue="curl">
          <TabsList>
            <TabsTrigger value="curl">curl</TabsTrigger>
            <TabsTrigger value="node">Node OpenFeature</TabsTrigger>
          </TabsList>
          <TabsContent value="curl">
            <Snippet code={sdk.curl} label="curl command" />
          </TabsContent>
          <TabsContent value="node">
            <Snippet code={sdk.node} label="Node snippet" />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Log in with the CLI</span>
          <Snippet code={cli} label="CLI command" />
        </div>
      )}

      <DialogFooter>
        <Button type="button" onClick={onClose}>
          I have copied the key
        </Button>
      </DialogFooter>
    </>
  )
}
