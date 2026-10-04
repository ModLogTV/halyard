import type { Serve } from '@halyard/engine'
import { Link } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { ArchiveIcon, BrushCleaningIcon } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnvironmentLike } from '@/components/env/env-badge'
import { EnvDot, envStyle } from '@/components/env/env-badge'
import { EnvToggle } from '@/components/flags/env-toggle'
import { FlagTypeBadge } from '@/components/flags/flag-type-badge'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatPercent, formatRelativeTime } from '@/lib/format'
import type { StaleAssessment } from '@/lib/stale'
import { describeStaleReason } from '@/lib/stale'
import { cn } from '@/lib/utils'

export interface FlagRow {
  id: string
  key: string
  name: string
  description: string | null
  type: 'boolean' | 'string' | 'number' | 'json'
  tags: string[]
  archivedAt: Date | string | null
  updatedAt: Date | string
  environments: {
    environmentId: string
    environmentKey: string
    enabled: boolean
    fallthrough: Serve
    ruleCount: number
    version: number
  }[]
  stats: {
    environmentId: string
    lastEvaluatedAt: Date | string
    lastVariant: string | null
    evaluationCount: number
  }[]
  staleness: StaleAssessment
}

export interface FlagTableEnvironment extends EnvironmentLike {
  id: string
}

const features = tableFeatures({})
const helper = createColumnHelper<typeof features, FlagRow>()
const EMPTY: FlagRow[] = []

export function summariseServe(serve: Serve): string {
  if (serve.type === 'variant') return serve.variant
  const active = serve.variations.filter((v) => v.weight > 0)
  if (active.length === 1 && active[0]) return active[0].variant
  return active.map((v) => `${v.variant} ${formatPercent(v.weight)}`).join(' · ')
}

export function FlagTable({
  flags,
  environments,
  projectSlug,
  canToggle,
  onToggle,
}: {
  flags: FlagRow[]
  environments: FlagTableEnvironment[]
  projectSlug: string
  canToggle: boolean
  onToggle: (flag: FlagRow, environment: FlagTableEnvironment, enabled: boolean) => Promise<void>
}) {
  const { t, i18n } = useTranslation(['flags', 'common'])
  const envName = useCallback(
    (id: string) => environments.find((e) => e.id === id)?.name ?? t('stale.anEnvironment'),
    [environments, t],
  )

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((row) => row.key, {
          id: 'flag',
          header: t('common:labels.flag'),
          cell: ({ row }) => {
            const flag = row.original
            return (
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <Link
                    to="/app/$projectSlug/flags/$flagKey"
                    params={{ projectSlug, flagKey: flag.key }}
                    className="truncate font-mono text-[13px] font-medium text-foreground hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {flag.key}
                  </Link>
                  <FlagTypeBadge type={flag.type} />
                  {flag.archivedAt ? (
                    <Badge variant="outline" className="gap-1 text-muted-foreground">
                      <ArchiveIcon className="size-3" /> {t('common:states.archived')}
                    </Badge>
                  ) : null}
                  {flag.staleness.stale ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="gap-1 border-warning/50 bg-warning-soft text-foreground"
                        >
                          <BrushCleaningIcon className="size-3" /> {t('common:states.stale')}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <ul className="list-disc space-y-0.5 pl-4">
                          {flag.staleness.reasons.map((r) => {
                            const text = describeStaleReason(r, envName, t)
                            return <li key={text}>{text}</li>
                          })}
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{flag.name}</span>
                  {flag.tags.length > 0 ? (
                    <span className="flex gap-1">
                      {flag.tags.slice(0, 3).map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px] font-normal"
                        >
                          {tag}
                        </Badge>
                      ))}
                      {flag.tags.length > 3 ? <span>+{flag.tags.length - 3}</span> : null}
                    </span>
                  ) : null}
                </div>
              </div>
            )
          },
        }),
        ...environments.map((environment) =>
          helper.accessor(
            (row) =>
              row.environments.find((e) => e.environmentId === environment.id)?.enabled ?? false,
            {
              id: `env:${environment.id}`,
              header: () => (
                <span className="inline-flex items-center gap-1.5">
                  <EnvDot env={environment} />
                  {environment.name}
                </span>
              ),
              cell: ({ row }) => {
                const flag = row.original
                const config = flag.environments.find((e) => e.environmentId === environment.id)
                if (!config) return <span className="text-muted-foreground">–</span>
                const stat = flag.stats.find((s) => s.environmentId === environment.id)
                return (
                  <div className="flex items-center gap-3" style={envStyle(environment)}>
                    <EnvToggle
                      flagKey={flag.key}
                      environment={environment}
                      enabled={config.enabled}
                      size="sm"
                      disabled={!canToggle || Boolean(flag.archivedAt)}
                      disabledReason={
                        flag.archivedAt
                          ? t('table.toggleDisabledArchived')
                          : t('table.toggleDisabledRole')
                      }
                      onChange={(enabled) => onToggle(flag, environment, enabled)}
                    />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span
                        className={cn(
                          'truncate font-mono text-xs',
                          !config.enabled && 'text-muted-foreground',
                        )}
                      >
                        {config.enabled
                          ? summariseServe(config.fallthrough)
                          : t('common:states.off')}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground tabular">
                        {config.ruleCount > 0
                          ? t('common:counts.rules', { count: config.ruleCount })
                          : t('table.noRules')}
                        {stat ? (
                          <>
                            {' · '}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  {formatRelativeTime(stat.lastEvaluatedAt, {
                                    locale: i18n.language,
                                  })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t('table.lastEvaluated', {
                                  time: formatDateTime(stat.lastEvaluatedAt, i18n.language),
                                })}{' '}
                                · {t('table.evaluations', { count: stat.evaluationCount })}
                              </TooltipContent>
                            </Tooltip>
                          </>
                        ) : null}
                      </span>
                    </div>
                  </div>
                )
              },
            },
          ),
        ),
      ]),
    [environments, projectSlug, canToggle, onToggle, envName, t, i18n.language],
  )

  const table = useTable({ features, columns, data: flags.length ? flags : EMPTY })

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead key={header.id} className="h-9 text-xs">
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className={cn(row.original.archivedAt && 'opacity-60')}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className="py-2.5 align-middle">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
