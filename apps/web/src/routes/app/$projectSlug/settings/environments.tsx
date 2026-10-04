import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { MotionConfig, motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnvBadge } from '@/components/env/env-badge'
import { ConfirmDialog } from '@/components/settings/confirm-dialog'
import { EnvironmentDialog } from '@/components/settings/environment-dialog'
import { errorMessage } from '@/components/settings/form-utils'
import { HintedButton, IconButton } from '@/components/settings/hinted-button'
import { SettingsSection } from '@/components/settings/settings-section'
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
import { Item, ItemActions, ItemContent } from '@/components/ui/item'
import { translate } from '@/lib/i18n'
import { deleteEnvironment, reorderEnvironments } from '@/server/functions/environments'
import type { Environment } from '@/server/services/environments'

export const Route = createFileRoute('/app/$projectSlug/settings/environments')({
  staticData: { crumbKey: 'environments' },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('settings:environments.pageTitle') }],
  }),
  component: EnvironmentsSettings,
})

function EnvironmentsSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const router = useRouter()
  const { project, isOwner } = useSettingsContext()
  const environments = [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder)
  const [createOpen, setCreateOpen] = useState(false)
  // The target is kept after closing so the dialogs do not change while they animate out.
  const [editing, setEditing] = useState<Environment | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState<Environment | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [moving, setMoving] = useState(false)

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= environments.length || moving) return
    const ids = environments.map((env) => env.id)
    const [moved] = ids.splice(index, 1)
    if (!moved) return
    ids.splice(target, 0, moved)
    setMoving(true)
    try {
      await reorderEnvironments({ data: { projectId: project.id, environmentIds: ids } })
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error, t('environments.reorderFailed')))
    } finally {
      setMoving(false)
    }
  }

  return (
    <SettingsSection
      title={t('common:labels.environments')}
      description={t('environments.description')}
      actions={
        <HintedButton
          onClick={() => setCreateOpen(true)}
          disabledReason={isOwner ? undefined : t('shared.ownerOnly')}
        >
          <PlusIcon /> {t('environments.add')}
        </HintedButton>
      }
    >
      {environments.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>{t('environments.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('environments.empty.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <HintedButton
              onClick={() => setCreateOpen(true)}
              disabledReason={isOwner ? undefined : t('shared.ownerOnly')}
            >
              <PlusIcon /> {t('environments.add')}
            </HintedButton>
          </EmptyContent>
        </Empty>
      ) : (
        <MotionConfig reducedMotion="user">
          <ul className="flex flex-col gap-2">
            {environments.map((env, index) => (
              <motion.li
                key={env.id}
                layout="position"
                transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
              >
                <Item variant="outline" size="sm">
                  <ItemContent className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
                    <EnvBadge env={env} />
                    <code className="font-mono text-xs text-muted-foreground">{env.key}</code>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        aria-hidden="true"
                        className="size-3.5 rounded-full border"
                        style={{ backgroundColor: env.color }}
                      />
                      <span className="font-mono">{env.color}</span>
                    </span>
                    {env.isProduction ? (
                      <Badge variant="secondary">{t('common:states.production')}</Badge>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <IconButton
                      label={t('environments.moveUp', { name: env.name })}
                      onClick={() => move(index, -1)}
                      disabledReason={
                        !isOwner
                          ? t('shared.ownerOnly')
                          : index === 0
                            ? t('environments.alreadyFirst')
                            : undefined
                      }
                      disabled={moving}
                    >
                      <ArrowUpIcon />
                    </IconButton>
                    <IconButton
                      label={t('environments.moveDown', { name: env.name })}
                      onClick={() => move(index, 1)}
                      disabledReason={
                        !isOwner
                          ? t('shared.ownerOnly')
                          : index === environments.length - 1
                            ? t('environments.alreadyLast')
                            : undefined
                      }
                      disabled={moving}
                    >
                      <ArrowDownIcon />
                    </IconButton>
                    <IconButton
                      label={t('environments.edit', { name: env.name })}
                      onClick={() => {
                        setEditing(env)
                        setEditOpen(true)
                      }}
                      disabledReason={isOwner ? undefined : t('shared.ownerOnly')}
                    >
                      <PencilIcon />
                    </IconButton>
                    <IconButton
                      label={t('environments.deleteAria', { name: env.name })}
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeleting(env)
                        setDeleteOpen(true)
                      }}
                      disabledReason={
                        !isOwner
                          ? t('shared.ownerOnly')
                          : environments.length <= 1
                            ? t('environments.keepOne')
                            : undefined
                      }
                    >
                      <Trash2Icon />
                    </IconButton>
                  </ItemActions>
                </Item>
              </motion.li>
            ))}
          </ul>
        </MotionConfig>
      )}

      <EnvironmentDialog projectId={project.id} open={createOpen} onOpenChange={setCreateOpen} />
      <EnvironmentDialog
        projectId={project.id}
        environment={editing ?? undefined}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('environments.delete.title', {
          name: deleting?.name ?? t('common:labels.environment'),
        })}
        description={t('environments.delete.description')}
        confirmLabel={t('environments.delete.confirm')}
        onConfirm={async () => {
          if (!deleting) return
          await deleteEnvironment({
            data: { projectId: project.id, environmentId: deleting.id },
          })
          toast.success(t('environments.delete.deleted', { name: deleting.name }))
          await router.invalidate()
        }}
      />
    </SettingsSection>
  )
}
