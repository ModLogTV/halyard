import { useRouter } from '@tanstack/react-router'
import { TriangleAlertIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation(['settings', 'common'])
  const router = useRouter()
  const [name, setName] = useState('')
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? '')
  const [access, setAccess] = useState<'read' | 'write'>('read')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const nameError = firstError(nameSchema, name)
  const showName = submitted ? nameError : undefined
  const envError =
    kind === 'sdk' && !environmentId ? t('apiKeys.create.environmentRequired') : undefined

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
      setServerError(errorMessage(error, t('apiKeys.create.failed')))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>
          {kind === 'sdk' ? t('apiKeys.create.sdkTitle') : t('apiKeys.create.managementTitle')}
        </DialogTitle>
        <DialogDescription>
          {kind === 'sdk'
            ? t('apiKeys.create.sdkDescription')
            : t('apiKeys.create.managementDescription')}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-5">
        <Field data-invalid={showName ? true : undefined}>
          <FieldLabel htmlFor="key-name">{t('common:labels.name')}</FieldLabel>
          <Input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              kind === 'sdk'
                ? t('apiKeys.create.sdkNamePlaceholder')
                : t('apiKeys.create.managementNamePlaceholder')
            }
            maxLength={64}
            aria-invalid={showName ? true : undefined}
            autoComplete="off"
            autoFocus
          />
          <FieldError>{showName}</FieldError>
        </Field>

        {kind === 'sdk' ? (
          <Field data-invalid={submitted && envError ? true : undefined}>
            <FieldLabel htmlFor="key-environment">{t('common:labels.environment')}</FieldLabel>
            <Select value={environmentId} onValueChange={setEnvironmentId}>
              <SelectTrigger id="key-environment" className="w-full">
                <SelectValue placeholder={t('apiKeys.create.environmentPlaceholder')} />
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
              <FieldDescription>{t('apiKeys.create.environmentHint')}</FieldDescription>
            )}
          </Field>
        ) : (
          <FieldSet>
            <FieldLegend variant="label">{t('apiKeys.create.accessLegend')}</FieldLegend>
            <RadioGroup
              value={access}
              onValueChange={(next) => setAccess(next as 'read' | 'write')}
            >
              <FieldLabel htmlFor="key-access-read">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{t('apiKeys.create.readTitle')}</FieldTitle>
                    <FieldDescription>{t('apiKeys.create.readDescription')}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value="read" id="key-access-read" />
                </Field>
              </FieldLabel>
              <FieldLabel htmlFor="key-access-write">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{t('apiKeys.create.writeTitle')}</FieldTitle>
                    <FieldDescription>{t('apiKeys.create.writeDescription')}</FieldDescription>
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
          {t('common:actions.cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {t('apiKeys.create.submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Snippet({ code, label, copyLabel }: { code: string; label: string; copyLabel: string }) {
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
        <CopyButton value={code} label={copyLabel} />
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
      <DialogContent className="sm:max-w-xl [&>*]:min-w-0">
        {revealed ? <RevealBody revealed={revealed} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function RevealBody({ revealed, onClose }: { revealed: RevealedKey; onClose: () => void }) {
  const { t } = useTranslation(['settings', 'common'])
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const sdk = sdkSnippets(origin, revealed.key)
  const cli = `halyard login --url ${origin} --key ${revealed.key}`

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('apiKeys.reveal.title')}</DialogTitle>
        <DialogDescription>
          {revealed.kind === 'sdk'
            ? t('apiKeys.reveal.readySdk', { name: revealed.name })
            : t('apiKeys.reveal.readyManagement', { name: revealed.name })}
        </DialogDescription>
      </DialogHeader>

      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('apiKeys.reveal.notShownTitle')}</AlertTitle>
        <AlertDescription>{t('apiKeys.reveal.notShownDescription')}</AlertDescription>
      </Alert>

      <Field>
        <FieldLabel htmlFor="revealed-key">{t('common:labels.key')}</FieldLabel>
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
            <Snippet
              code={sdk.curl}
              label={t('apiKeys.reveal.curlLabel')}
              copyLabel={t('apiKeys.reveal.curlCopy')}
            />
          </TabsContent>
          <TabsContent value="node">
            <Snippet
              code={sdk.node}
              label={t('apiKeys.reveal.nodeLabel')}
              copyLabel={t('apiKeys.reveal.nodeCopy')}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('apiKeys.reveal.cliHeading')}</span>
          <Snippet
            code={cli}
            label={t('apiKeys.reveal.cliLabel')}
            copyLabel={t('apiKeys.reveal.cliCopy')}
          />
        </div>
      )}

      <DialogFooter>
        <Button type="button" onClick={onClose}>
          {t('apiKeys.reveal.done')}
        </Button>
      </DialogFooter>
    </>
  )
}
