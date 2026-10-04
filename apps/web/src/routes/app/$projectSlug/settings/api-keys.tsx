import { createFileRoute, useRouter } from '@tanstack/react-router'
import { KeyRoundIcon, PlusIcon, ShieldIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EnvBadge } from '@/components/env/env-badge'
import { ConfirmDialog } from '@/components/settings/confirm-dialog'
import { HintedButton, IconButton } from '@/components/settings/hinted-button'
import {
  CreateManagementKeyDialog,
  CreateSdkKeyDialog,
  KeyRevealDialog,
  type RevealedKey,
} from '@/components/settings/key-dialogs'
import { SettingsPending, SettingsSection } from '@/components/settings/settings-section'
import { OWNER_ONLY_MESSAGE, useSettingsContext } from '@/components/settings/use-settings-context'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { listApiKeys, revokeApiKey } from '@/server/functions/api-keys'
import type { ApiKeySummary } from '@/server/services/api-keys'

export const Route = createFileRoute('/app/$projectSlug/settings/api-keys')({
  staticData: { crumbKey: 'apiKeys' },
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData?.projectId
    if (!projectId) return { keys: [] }
    return { keys: await listApiKeys({ data: { projectId } }) }
  },
  head: () => ({ meta: [{ title: 'API keys · Halyard' }] }),
  pendingComponent: () => <SettingsPending rows={3} />,
  component: ApiKeysSettings,
})

function RelativeTime({ value, never = 'Never' }: { value: Date | string | null; never?: string }) {
  if (!value) return <span className="text-muted-foreground/70">{never}</span>
  return (
    <time dateTime={new Date(value).toISOString()} title={formatDateTime(value)}>
      {formatRelativeTime(value)}
    </time>
  )
}

function ApiKeysSettings() {
  const { project, isOwner } = useSettingsContext()
  const { keys } = Route.useLoaderData()
  const [sdkOpen, setSdkOpen] = useState(false)
  const [managementOpen, setManagementOpen] = useState(false)
  const [revealed, setRevealed] = useState<RevealedKey | null>(null)
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const router = useRouter()

  const sdkKeys = keys.filter((k) => k.configId === 'sdk')
  const managementKeys = keys.filter((k) => k.configId === 'management')
  const reason = isOwner ? undefined : OWNER_ONLY_MESSAGE
  const environments = [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder)

  const createSdk = (
    <HintedButton
      onClick={() => setSdkOpen(true)}
      disabledReason={
        reason ?? (environments.length === 0 ? 'Add an environment first' : undefined)
      }
    >
      <PlusIcon /> Create SDK key
    </HintedButton>
  )
  const createManagement = (
    <HintedButton onClick={() => setManagementOpen(true)} disabledReason={reason}>
      <PlusIcon /> Create management key
    </HintedButton>
  )

  function revokeButton(key: ApiKeySummary) {
    return (
      <IconButton
        label={`Revoke ${key.name ?? 'key'}`}
        className="text-destructive hover:text-destructive"
        disabledReason={reason}
        onClick={() => {
          setRevoking(key)
          setRevokeOpen(true)
        }}
      >
        <Trash2Icon />
      </IconButton>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="SDK keys"
        description="Environment-scoped keys for OpenFeature SDKs and anything that speaks OFREP. Keys can only read flags."
        actions={sdkKeys.length > 0 ? createSdk : undefined}
      >
        {sdkKeys.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRoundIcon />
              </EmptyMedia>
              <EmptyTitle>No SDK keys</EmptyTitle>
              <EmptyDescription>
                Create a key to evaluate flags from your application. Each key is tied to one
                environment.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{createSdk}</EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="hidden md:table-cell">Last used</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sdkKeys.map((key) => {
                  const env = environments.find((e) => e.id === key.environmentId)
                  return (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name ?? 'Untitled key'}</TableCell>
                      <TableCell>
                        {env ? (
                          <EnvBadge env={env} />
                        ) : (
                          <span className="text-muted-foreground">Unknown environment</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{key.start ?? ''}…</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        <RelativeTime value={key.createdAt} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        <RelativeTime value={key.lastRequest} />
                      </TableCell>
                      <TableCell className="text-right">{revokeButton(key)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Management keys"
        description="Project-scoped keys for the Halyard CLI and the REST API."
        actions={managementKeys.length > 0 ? createManagement : undefined}
      >
        {managementKeys.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldIcon />
              </EmptyMedia>
              <EmptyTitle>No management keys</EmptyTitle>
              <EmptyDescription>
                Create a key to script this project from CI or log in with the CLI.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{createManagement}</EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="hidden md:table-cell">Last used</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managementKeys.map((key) => {
                  const canWrite = key.permissions?.project?.includes('write') ?? false
                  return (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name ?? 'Untitled key'}</TableCell>
                      <TableCell>
                        <Badge variant={canWrite ? 'default' : 'secondary'}>
                          {canWrite ? 'Read & write' : 'Read'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{key.start ?? ''}…</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        <RelativeTime value={key.createdAt} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        <RelativeTime value={key.lastRequest} />
                      </TableCell>
                      <TableCell className="text-right">{revokeButton(key)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SettingsSection>

      <CreateSdkKeyDialog
        projectId={project.id}
        environments={environments}
        open={sdkOpen}
        onOpenChange={setSdkOpen}
        onCreated={setRevealed}
      />
      <CreateManagementKeyDialog
        projectId={project.id}
        open={managementOpen}
        onOpenChange={setManagementOpen}
        onCreated={setRevealed}
      />
      <KeyRevealDialog revealed={revealed} onClose={() => setRevealed(null)} />
      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={`Revoke ${revoking?.name ?? 'this key'}?`}
        description={
          revoking?.configId === 'sdk'
            ? 'Applications using this key stop receiving flags right away. This cannot be undone.'
            : 'Scripts and CLI sessions using this key stop working right away. This cannot be undone.'
        }
        confirmLabel="Revoke key"
        onConfirm={async () => {
          if (!revoking) return
          await revokeApiKey({
            data: { projectId: project.id, keyId: revoking.id, configId: revoking.configId },
          })
          toast.success(`Key "${revoking.name ?? 'Untitled key'}" revoked`)
          await router.invalidate()
        }}
      />
    </div>
  )
}
