import { createFileRoute, useRouter } from '@tanstack/react-router'
import { KeyRoundIcon, PlusIcon, ShieldIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useSettingsContext } from '@/components/settings/use-settings-context'
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
import { translate } from '@/lib/i18n'
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
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('settings:apiKeys.pageTitle') }],
  }),
  pendingComponent: () => <SettingsPending rows={3} />,
  component: ApiKeysSettings,
})

function RelativeTime({ value }: { value: Date | string | null }) {
  const { t, i18n } = useTranslation('common')
  if (!value) return <span className="text-muted-foreground/70">{t('states.never')}</span>
  return (
    <time dateTime={new Date(value).toISOString()} title={formatDateTime(value, i18n.language)}>
      {formatRelativeTime(value, { locale: i18n.language })}
    </time>
  )
}

function ApiKeysSettings() {
  const { t } = useTranslation(['settings', 'common'])
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
  const reason = isOwner ? undefined : t('shared.ownerOnly')
  const environments = [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder)

  const createSdk = (
    <HintedButton
      onClick={() => setSdkOpen(true)}
      disabledReason={
        reason ?? (environments.length === 0 ? t('apiKeys.addEnvironmentFirst') : undefined)
      }
    >
      <PlusIcon /> {t('apiKeys.sdk.create')}
    </HintedButton>
  )
  const createManagement = (
    <HintedButton onClick={() => setManagementOpen(true)} disabledReason={reason}>
      <PlusIcon /> {t('apiKeys.management.create')}
    </HintedButton>
  )

  function revokeButton(key: ApiKeySummary) {
    return (
      <IconButton
        label={t('apiKeys.revokeAria', { name: key.name ?? t('apiKeys.revokeFallbackName') })}
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
        title={t('apiKeys.sdk.title')}
        description={t('apiKeys.sdk.description')}
        actions={sdkKeys.length > 0 ? createSdk : undefined}
      >
        {sdkKeys.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRoundIcon />
              </EmptyMedia>
              <EmptyTitle>{t('apiKeys.sdk.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('apiKeys.sdk.empty.description')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{createSdk}</EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.name')}</TableHead>
                  <TableHead>{t('common:labels.environment')}</TableHead>
                  <TableHead>{t('common:labels.key')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('common:labels.created')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">{t('apiKeys.lastUsed')}</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">{t('common:labels.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sdkKeys.map((key) => {
                  const env = environments.find((e) => e.id === key.environmentId)
                  return (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">
                        {key.name ?? t('apiKeys.untitled')}
                      </TableCell>
                      <TableCell>
                        {env ? (
                          <EnvBadge env={env} />
                        ) : (
                          <span className="text-muted-foreground">
                            {t('apiKeys.unknownEnvironment')}
                          </span>
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
        title={t('apiKeys.management.title')}
        description={t('apiKeys.management.description')}
        actions={managementKeys.length > 0 ? createManagement : undefined}
      >
        {managementKeys.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldIcon />
              </EmptyMedia>
              <EmptyTitle>{t('apiKeys.management.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('apiKeys.management.empty.description')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{createManagement}</EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.name')}</TableHead>
                  <TableHead>{t('apiKeys.management.access')}</TableHead>
                  <TableHead>{t('common:labels.key')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('common:labels.created')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">{t('apiKeys.lastUsed')}</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">{t('common:labels.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managementKeys.map((key) => {
                  const canWrite = key.permissions?.project?.includes('write') ?? false
                  return (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">
                        {key.name ?? t('apiKeys.untitled')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={canWrite ? 'default' : 'secondary'}>
                          {canWrite
                            ? t('apiKeys.management.readWrite')
                            : t('apiKeys.management.read')}
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
        title={t('apiKeys.revoke.title', {
          name: revoking?.name ?? t('apiKeys.revoke.fallbackName'),
        })}
        description={
          revoking?.configId === 'sdk'
            ? t('apiKeys.revoke.descriptionSdk')
            : t('apiKeys.revoke.descriptionManagement')
        }
        confirmLabel={t('apiKeys.revoke.confirm')}
        onConfirm={async () => {
          if (!revoking) return
          await revokeApiKey({
            data: { projectId: project.id, keyId: revoking.id, configId: revoking.configId },
          })
          toast.success(
            t('apiKeys.revoke.revoked', { name: revoking.name ?? t('apiKeys.untitled') }),
          )
          await router.invalidate()
        }}
      />
    </div>
  )
}
