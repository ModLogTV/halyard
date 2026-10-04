import type { FlagType, Variant } from '@halyard/engine'
import { Link, useRouter } from '@tanstack/react-router'
import {
  BanIcon,
  ListOrderedIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnvBadge, type EnvironmentLike } from '@/components/env/env-badge'
import { ConfirmDialog } from '@/components/settings/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemGroup } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  cancelPlan,
  cancelScheduledChange,
  createScheduledChange,
} from '@/server/functions/scheduled-changes'
import { ChangeSummary } from './change-summary'
import { EditScheduleDialog } from './edit-schedule-dialog'
import { ScheduleStatusBadge } from './status-badge'
import {
  dayKey,
  formatDayHeading,
  formatDelta,
  formatFullDateTime,
  formatTimeOfDay,
  MINUTE,
  planSteps,
  type ScheduledChangeItem,
  type ScheduleT,
} from './utils'

export interface TimelineFlagInfo {
  type: FlagType
  variants: Variant[]
}

export interface ScheduleTimelineProps {
  projectId: string
  projectSlug: string
  /** The rows to show, in display order. */
  items: ScheduledChangeItem[]
  /** Every loaded row; used to count the steps of a plan and to bound edits. */
  all: ScheduledChangeItem[]
  environments: Map<string, EnvironmentLike>
  flags: Map<string, TimelineFlagInfo>
  canEdit: boolean
  now: Date
}

interface Group {
  key: string
  heading: string
  items: ScheduledChangeItem[]
}

function groupByDay(
  items: ScheduledChangeItem[],
  now: Date,
  t: ScheduleT,
  locale: string,
): Group[] {
  const groups: Group[] = []
  for (const item of items) {
    const date = new Date(item.scheduledFor)
    const key = dayKey(date)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, heading: formatDayHeading(date, t, locale, now), items: [item] })
  }
  return groups
}

export function ScheduleTimeline({
  projectId,
  projectSlug,
  items,
  all,
  environments,
  flags,
  canEdit,
  now,
}: ScheduleTimelineProps) {
  const { t, i18n } = useTranslation(['schedules', 'common'])
  const router = useRouter()
  const [editing, setEditing] = useState<ScheduledChangeItem | null>(null)
  const [cancelling, setCancelling] = useState<ScheduledChangeItem | null>(null)
  const [cancellingPlan, setCancellingPlan] = useState<ScheduledChangeItem | null>(null)
  const [retrying, setRetrying] = useState<ScheduledChangeItem | null>(null)
  const groups = useMemo(
    () => groupByDay(items, now, t, i18n.language),
    [items, now, t, i18n.language],
  )

  const planPending = cancellingPlan?.planId
    ? planSteps(all, cancellingPlan.planId).filter((s) => s.status === 'pending').length
    : 0

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.heading} className="flex flex-col gap-2">
            <h2 className="font-medium text-muted-foreground text-sm">{group.heading}</h2>
            <ItemGroup className="gap-2">
              <AnimatePresence initial={false}>
                {group.items.map((item) => (
                  <motion.div
                    key={item.id}
                    layout="position"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    role="listitem"
                  >
                    <ScheduleRow
                      item={item}
                      all={all}
                      projectSlug={projectSlug}
                      env={environments.get(item.environmentKey)}
                      flag={flags.get(item.flagKey)}
                      canEdit={canEdit}
                      now={now}
                      onEdit={() => setEditing(item)}
                      onCancel={() => setCancelling(item)}
                      onCancelPlan={() => setCancellingPlan(item)}
                      onRetry={() => setRetrying(item)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </ItemGroup>
          </section>
        ))}
      </div>

      <EditScheduleDialog
        item={editing}
        all={all}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null)
        }}
        title={t('cancel.title')}
        description={
          cancelling ? (
            <>
              <Trans
                t={t}
                i18nKey="cancel.body"
                values={{
                  flag: cancelling.flagKey,
                  time: formatFullDateTime(cancelling.scheduledFor, i18n.language),
                }}
                components={[<span key="flag" className="font-mono text-foreground" />]}
              />
              {cancelling.planId ? ` ${t('cancel.planNote')}` : ''}
            </>
          ) : null
        }
        confirmLabel={t('cancel.confirm')}
        cancelLabel={t('cancel.keep')}
        onConfirm={async () => {
          if (!cancelling) return
          await cancelScheduledChange({ data: { projectId, id: cancelling.id } })
          toast.success(t('cancel.toast'))
          await router.invalidate()
        }}
      />

      <ConfirmDialog
        open={cancellingPlan !== null}
        onOpenChange={(open) => {
          if (!open) setCancellingPlan(null)
        }}
        title={t('cancelPlan.title')}
        description={
          cancellingPlan ? (
            <Trans
              t={t}
              i18nKey="cancelPlan.body"
              count={planPending}
              values={{ flag: cancellingPlan.flagKey }}
              components={[<span key="flag" className="font-mono text-foreground" />]}
            />
          ) : null
        }
        confirmLabel={t('cancelPlan.confirm')}
        cancelLabel={t('cancel.keep')}
        onConfirm={async () => {
          if (!cancellingPlan?.planId) return
          const result = await cancelPlan({ data: { projectId, planId: cancellingPlan.planId } })
          toast.success(t('cancelPlan.toast', { count: result.cancelled }))
          await router.invalidate()
        }}
      />

      <ConfirmDialog
        open={retrying !== null}
        onOpenChange={(open) => {
          if (!open) setRetrying(null)
        }}
        title={t('retry.title')}
        destructive={false}
        description={
          retrying ? (
            <>
              <Trans
                t={t}
                i18nKey="retry.body"
                values={{
                  flag: retrying.flagKey,
                  environment:
                    environments.get(retrying.environmentKey)?.name ?? retrying.environmentKey,
                }}
                components={[<span key="flag" className="font-mono text-foreground" />]}
              />
              {environments.get(retrying.environmentKey)?.isProduction
                ? ` ${t('retry.productionNote')}`
                : ''}
            </>
          ) : null
        }
        confirmLabel={t('retry.confirm')}
        onConfirm={async () => {
          if (!retrying) return
          await createScheduledChange({
            data: {
              projectId,
              flagKey: retrying.flagKey,
              environmentKey: retrying.environmentKey,
              scheduledFor: new Date(Date.now() + MINUTE),
              change: retrying.change,
              note: retrying.note ?? undefined,
            },
          })
          toast.success(t('retry.toast'))
          await router.invalidate()
        }}
      />
    </MotionConfig>
  )
}

function ScheduleRow({
  item,
  all,
  projectSlug,
  env,
  flag,
  canEdit,
  now,
  onEdit,
  onCancel,
  onCancelPlan,
  onRetry,
}: {
  item: ScheduledChangeItem
  all: ScheduledChangeItem[]
  projectSlug: string
  env: EnvironmentLike | undefined
  flag: TimelineFlagInfo | undefined
  canEdit: boolean
  now: Date
  onEdit: () => void
  onCancel: () => void
  onCancelPlan: () => void
  onRetry: () => void
}) {
  const { t, i18n } = useTranslation(['schedules', 'common'])
  const date = new Date(item.scheduledFor)
  const steps = item.planId ? planSteps(all, item.planId) : []
  const pendingInPlan = steps.filter((s) => s.status === 'pending').length
  const muted = item.status === 'cancelled'
  const canEditThis = canEdit && item.status === 'pending'
  const canRetry = canEdit && item.status === 'failed'
  const canCancelPlan = canEdit && item.status === 'pending' && item.planId && pendingInPlan > 0
  const hasMenu = canEditThis || canRetry

  return (
    <Item variant="outline" size="sm" className={muted ? 'opacity-70' : undefined}>
      <div className="w-24 shrink-0">
        <time
          dateTime={date.toISOString()}
          title={formatFullDateTime(date, i18n.language)}
          className="tabular block font-medium text-sm"
        >
          {formatTimeOfDay(date, i18n.language)}
        </time>
        <span className="block text-muted-foreground text-xs">
          {formatDelta(date, now, i18n.language)}
        </span>
      </div>
      <ItemContent className="min-w-0 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/$projectSlug/flags/$flagKey"
            params={{ projectSlug, flagKey: item.flagKey }}
            search={{ env: item.environmentKey }}
            className="font-mono text-sm underline-offset-4 hover:underline"
          >
            {item.flagKey}
          </Link>
          {env ? (
            <EnvBadge env={env} />
          ) : (
            <span className="font-mono text-muted-foreground text-xs">{item.environmentKey}</span>
          )}
          {item.planId ? (
            <Badge variant="secondary" className="gap-1 font-normal">
              <ListOrderedIcon />
              {t('row.stepOf', { number: item.stepIndex + 1, total: steps.length })}
            </Badge>
          ) : null}
        </div>
        <ChangeSummary change={item.change} variants={flag?.variants} type={flag?.type} />
        {item.note ? <p className="text-muted-foreground text-sm">{item.note}</p> : null}
        {item.status === 'failed' && item.error ? (
          <p className="text-destructive text-xs">{item.error}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {t('row.scheduledBy', { name: item.createdByName ?? t('row.deletedUser') })}
        </p>
      </ItemContent>
      <ItemActions>
        <ScheduleStatusBadge status={item.status} error={item.error} />
        {hasMenu ? (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('row.actionsAriaLabel', {
                      flag: item.flagKey,
                      time: formatTimeOfDay(date, i18n.language),
                    })}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('common:labels.actions')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              {canEditThis ? (
                <DropdownMenuItem onClick={onEdit}>
                  <PencilIcon /> {t('common:actions.edit')}
                </DropdownMenuItem>
              ) : null}
              {canRetry ? (
                <DropdownMenuItem onClick={onRetry}>
                  <RotateCcwIcon /> {t('common:actions.retry')}
                </DropdownMenuItem>
              ) : null}
              {canEditThis ? <DropdownMenuSeparator /> : null}
              {canEditThis ? (
                <DropdownMenuItem variant="destructive" onClick={onCancel}>
                  <XIcon /> {t('cancel.menuItem')}
                </DropdownMenuItem>
              ) : null}
              {canCancelPlan ? (
                <DropdownMenuItem variant="destructive" onClick={onCancelPlan}>
                  <BanIcon /> {t('cancelPlan.menuItem', { count: pendingInPlan })}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </ItemActions>
    </Item>
  )
}
