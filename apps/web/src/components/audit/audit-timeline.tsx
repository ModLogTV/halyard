import { useMatch } from '@tanstack/react-router'
import { ChevronRightIcon, CogIcon, HistoryIcon, KeyRoundIcon } from 'lucide-react'
import { useMemo } from 'react'
import { EnvBadge, type EnvironmentLike } from '@/components/env/env-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { type AuditEntryLike, dayKey, dayLabel, describeAuditAction, initials } from './describe'
import { JsonDiff } from './json-diff'

export type AuditTimelineEnvironment = EnvironmentLike & { id: string }

export interface AuditTimelineProps {
  items: AuditEntryLike[]
  /**
   * Environments used to resolve `environmentId`. Defaults to the environments of the
   * surrounding project route, so inside `/app/$projectSlug/...` you can omit it.
   */
  environments?: AuditTimelineEnvironment[]
  /** Replaces the default empty state. */
  empty?: React.ReactNode
  className?: string
}

function ActorAvatar({ entry }: { entry: AuditEntryLike }) {
  return (
    <Avatar size="sm" className="mt-0.5">
      <AvatarFallback className="text-[10px]">
        {entry.actorType === 'api_key' ? (
          <KeyRoundIcon className="size-3.5" aria-label="API key" />
        ) : entry.actorType === 'system' ? (
          <CogIcon className="size-3.5" aria-label="System" />
        ) : (
          initials(entry.actorName)
        )}
      </AvatarFallback>
    </Avatar>
  )
}

function Sentence({
  entry,
  environment,
}: {
  entry: AuditEntryLike
  environment: AuditTimelineEnvironment | undefined
}) {
  const sentence = describeAuditAction(entry)
  return (
    <p className="min-w-0 text-sm leading-6">
      <strong className="font-semibold">{entry.actorName}</strong>{' '}
      {sentence.raw ? (
        <>
          performed{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{entry.action}</code>
        </>
      ) : (
        sentence.verb
      )}
      {sentence.entityLabel ? <> {sentence.entityLabel}</> : null}
      {entry.entityKey ? (
        <>
          {' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{entry.entityKey}</code>
        </>
      ) : null}
      {environment ? (
        <>
          {' '}
          {sentence.environmentPreposition} <EnvBadge env={environment} className="align-middle" />
        </>
      ) : null}
    </p>
  )
}

function AuditRow({
  entry,
  environment,
}: {
  entry: AuditEntryLike
  environment: AuditTimelineEnvironment | undefined
}) {
  const hasDetails = entry.before !== null || entry.after !== null
  return (
    <Item size="sm" className="items-start" role="listitem">
      <ItemMedia>
        <ActorAvatar entry={entry} />
      </ItemMedia>
      <ItemContent className="min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Sentence entry={entry} environment={environment} />
          <span aria-hidden="true" className="text-muted-foreground text-xs">
            ·
          </span>
          <time
            dateTime={new Date(entry.createdAt).toISOString()}
            title={formatDateTime(entry.createdAt)}
            className="whitespace-nowrap text-muted-foreground text-xs"
          >
            {formatRelativeTime(entry.createdAt)}
          </time>
        </div>
        {hasDetails ? (
          <Collapsible className="group/details">
            <CollapsibleTrigger className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <ChevronRightIcon
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[state=open]/details:rotate-90"
              />
              Details
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <JsonDiff before={entry.before} after={entry.after} />
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </ItemContent>
    </Item>
  )
}

/**
 * Chronological list of audit entries grouped by day, newest first as given. Each entry reads
 * as a sentence and expands to a before/after diff.
 */
export function AuditTimeline({ items, environments, empty, className }: AuditTimelineProps) {
  const projectMatch = useMatch({ from: '/app/$projectSlug', shouldThrow: false })
  const envs: AuditTimelineEnvironment[] = useMemo(
    () => environments ?? projectMatch?.loaderData?.project.environments ?? [],
    [environments, projectMatch],
  )

  const groups = useMemo(() => {
    const out: { key: string; label: string; entries: AuditEntryLike[] }[] = []
    for (const entry of items) {
      const key = dayKey(entry.createdAt)
      const last = out[out.length - 1]
      if (last && last.key === key) last.entries.push(entry)
      else out.push({ key, label: dayLabel(entry.createdAt), entries: [entry] })
    }
    return out
  }, [items])

  if (items.length === 0) {
    return (
      empty ?? (
        <Empty className={cn('rounded-lg border border-dashed', className)}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>No activity</EmptyTitle>
            <EmptyDescription>Changes will show up here as they happen.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    )
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label} className="flex flex-col gap-1">
          <h3 className="px-4 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {group.label}
          </h3>
          <ItemGroup className="divide-y rounded-lg border">
            {group.entries.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                environment={envs.find((env) => env.id === entry.environmentId)}
              />
            ))}
          </ItemGroup>
        </section>
      ))}
    </div>
  )
}
