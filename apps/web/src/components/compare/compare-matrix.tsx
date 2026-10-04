import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { EnvDot, envStyle } from '@/components/env/env-badge'
import { summariseServe } from '@/components/flags/flag-table'
import { FlagTypeBadge } from '@/components/flags/flag-type-badge'
import { IconButton } from '@/components/flags/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FlagDetail } from './flag-detail'
import { PromoteButton } from './promote-button'
import { type CompareEnvironment, cellDiffers, type FlagSummaryRow, summaryFor } from './utils'

export interface CompareMatrixProps {
  projectId: string
  projectSlug: string
  flags: FlagSummaryRow[]
  environments: CompareEnvironment[]
  baseline: CompareEnvironment
  onBaselineChange: (key: string) => void
  expanded: ReadonlySet<string>
  onToggleExpanded: (flagKey: string) => void
  selected: ReadonlySet<string>
  onSelectedChange: (selected: Set<string>) => void
  /** Why promoting is unavailable, or undefined when allowed. */
  promoteDisabledReason?: string
  onPromote: (flagKey: string, fromKey: string, toKey: string) => void
}

function MatrixCell({
  flag,
  environment,
  baseline,
  promoteDisabledReason,
  onPromote,
}: {
  flag: FlagSummaryRow
  environment: CompareEnvironment
  baseline: CompareEnvironment
  promoteDisabledReason?: string
  onPromote: () => void
}) {
  const { t } = useTranslation(['compare', 'common'])
  const summary = summaryFor(flag, environment)
  const isBaseline = environment.id === baseline.id
  const differs = cellDiffers(flag, environment, baseline)
  if (!summary) return <span className="text-muted-foreground">–</span>
  return (
    <div
      className={cn(
        'flex min-w-36 flex-col gap-1 py-1.5 pr-2 pl-3',
        !differs && !isBaseline && 'text-muted-foreground',
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-full',
            summary.enabled ? 'bg-on' : 'bg-muted-foreground/40',
          )}
        />
        {summary.enabled ? t('common:states.on') : t('common:states.off')}
        {differs ? (
          <span className="sr-only">
            {' '}
            {t('matrix.differsFromBaseline', { baseline: baseline.name })}
          </span>
        ) : null}
      </span>
      <span className="truncate font-mono text-xs" title={summariseServe(summary.fallthrough)}>
        {summariseServe(summary.fallthrough)}
      </span>
      <span className="tabular truncate text-[11px] text-muted-foreground">
        {t('matrix.ruleSummary', {
          rules:
            summary.ruleCount > 0
              ? t('common:counts.rules', { count: summary.ruleCount })
              : t('matrix.noRules'),
          version: summary.version,
        })}
      </span>
      {isBaseline ? null : (
        <PromoteButton
          label={t('promote.label', {
            flag: flag.key,
            from: baseline.name,
            to: environment.name,
          })}
          disabledReason={promoteDisabledReason}
          onClick={onPromote}
          className={cn(
            'mt-0.5 self-start transition-opacity',
            !differs &&
              'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100',
          )}
        />
      )}
    </div>
  )
}

/** Flags by environments. Cells that differ from the baseline column are tinted. */
export function CompareMatrix({
  projectId,
  projectSlug,
  flags,
  environments,
  baseline,
  onBaselineChange,
  expanded,
  onToggleExpanded,
  selected,
  onSelectedChange,
  promoteDisabledReason,
  onPromote,
}: CompareMatrixProps) {
  const { t } = useTranslation(['compare', 'common'])
  const allSelected = flags.length > 0 && flags.every((f) => selected.has(f.key))
  const someSelected = flags.some((f) => selected.has(f.key))

  function toggleAll(checked: boolean) {
    const next = new Set(selected)
    for (const flag of flags) {
      if (checked) next.add(flag.key)
      else next.delete(flag.key)
    }
    onSelectedChange(next)
  }

  function toggleOne(key: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(key)
    else next.delete(key)
    onSelectedChange(next)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label={t('matrix.selectAll')}
                />
              </TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{t('matrix.expandColumn')}</span>
              </TableHead>
              <TableHead className="min-w-56">{t('common:labels.flag')}</TableHead>
              {environments.map((environment) => (
                <TableHead key={environment.id} className="min-w-44 align-top">
                  <div className="flex flex-col gap-1 py-1" style={envStyle(environment)}>
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <EnvDot env={environment} />
                      {environment.name}
                    </span>
                    <label className="flex w-fit cursor-pointer items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                      <input
                        type="radio"
                        name="compare-baseline"
                        value={environment.key}
                        checked={environment.id === baseline.id}
                        onChange={() => onBaselineChange(environment.key)}
                        className="size-3 accent-primary"
                      />
                      {t('matrix.baseline')}
                    </label>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.map((flag) => {
              const open = expanded.has(flag.key)
              const isSelected = selected.has(flag.key)
              return (
                <FlagRows
                  key={flag.key}
                  open={open}
                  isSelected={isSelected}
                  flag={flag}
                  {...{
                    projectId,
                    projectSlug,
                    environments,
                    baseline,
                    promoteDisabledReason,
                    onPromote,
                    onToggleExpanded,
                    toggleOne,
                  }}
                />
              )
            })}
          </TableBody>
        </Table>
      </div>
    </MotionConfig>
  )
}

function FlagRows({
  flag,
  open,
  isSelected,
  projectId,
  projectSlug,
  environments,
  baseline,
  promoteDisabledReason,
  onPromote,
  onToggleExpanded,
  toggleOne,
}: {
  flag: FlagSummaryRow
  open: boolean
  isSelected: boolean
  projectId: string
  projectSlug: string
  environments: CompareEnvironment[]
  baseline: CompareEnvironment
  promoteDisabledReason?: string
  onPromote: CompareMatrixProps['onPromote']
  onToggleExpanded: (flagKey: string) => void
  toggleOne: (key: string, checked: boolean) => void
}) {
  const { t } = useTranslation(['compare', 'common'])
  // Version numbers change when a flag is edited or promoted, which reloads an open detail.
  const versionKey = flag.environments.map((e) => e.version).join('.')
  return (
    <>
      <TableRow
        data-state={isSelected ? 'selected' : undefined}
        onClick={() => onToggleExpanded(flag.key)}
        className="group/row cursor-pointer align-top"
      >
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => toggleOne(flag.key, checked === true)}
            aria-label={t('matrix.selectFlag', { flag: flag.key })}
          />
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <IconButton
            label={t(open ? 'matrix.collapseFlag' : 'matrix.expandFlag', { flag: flag.key })}
            tooltip={t(open ? 'matrix.collapseTooltip' : 'matrix.expandTooltip')}
            aria-expanded={open}
            onClick={() => onToggleExpanded(flag.key)}
          >
            <ChevronRightIcon
              className={cn('transition-transform duration-150', open && 'rotate-90')}
            />
          </IconButton>
        </TableCell>
        <TableCell>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <Link
                to="/app/$projectSlug/flags/$flagKey"
                params={{ projectSlug, flagKey: flag.key }}
                onClick={(e) => e.stopPropagation()}
                className="truncate rounded-sm font-mono text-[13px] font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {flag.key}
              </Link>
              <FlagTypeBadge type={flag.type} />
            </div>
            <span className="truncate text-xs text-muted-foreground">{flag.name}</span>
          </div>
        </TableCell>
        {environments.map((environment) => (
          <TableCell
            key={environment.id}
            className={cn(
              'p-0',
              cellDiffers(flag, environment, baseline) &&
                'bg-warning-soft shadow-[inset_2px_0_0_0_var(--warning)]',
            )}
          >
            <MatrixCell
              flag={flag}
              environment={environment}
              baseline={baseline}
              promoteDisabledReason={promoteDisabledReason}
              onPromote={() => onPromote(flag.key, baseline.key, environment.key)}
            />
          </TableCell>
        ))}
      </TableRow>
      <TableRow className={cn('hover:bg-transparent', open ? 'bg-muted/30' : 'border-0')}>
        <TableCell colSpan={3 + environments.length} className="p-0">
          <AnimatePresence initial={false}>
            {open ? (
              <motion.div
                key="detail"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <FlagDetail
                  key={versionKey}
                  projectId={projectId}
                  flagKey={flag.key}
                  environments={environments}
                  baseline={baseline}
                  renderAction={(environment) => (
                    <PromoteButton
                      label={t('promote.label', {
                        flag: flag.key,
                        from: baseline.name,
                        to: environment.name,
                      })}
                      disabledReason={promoteDisabledReason}
                      onClick={() => onPromote(flag.key, baseline.key, environment.key)}
                    />
                  )}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </TableCell>
      </TableRow>
    </>
  )
}
