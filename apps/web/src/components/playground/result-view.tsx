import type { ResolutionReason } from '@halyard/engine'
import { ArrowLeftIcon, FlaskConicalIcon, TriangleAlertIcon } from 'lucide-react'
import { MotionConfig, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { EnvBadge, type EnvironmentLike } from '@/components/env/env-badge'
import { FlagTypeBadge, RolloutBar, VariantValue, variantColor } from '@/components/flags'
import { describeCondition } from '@/components/segments/describe'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatPercent, formatVariantValue, pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PlaygroundFlagResult } from '@/server/functions/playground'

const REASON_STYLES: Record<ResolutionReason, { label: string; className: string }> = {
  DISABLED: { label: 'Disabled', className: 'border-border bg-muted text-muted-foreground' },
  TARGETING_MATCH: {
    label: 'Targeting match',
    className: 'border-transparent bg-on-soft text-foreground',
  },
  SPLIT: { label: 'Split', className: 'border-transparent bg-info-soft text-foreground' },
  STATIC: { label: 'Static', className: 'border-border bg-secondary text-secondary-foreground' },
  ERROR: { label: 'Error', className: 'border-transparent bg-destructive/10 text-destructive' },
}

export function ReasonBadge({
  reason,
  className,
}: {
  reason: ResolutionReason
  className?: string
}) {
  const style = REASON_STYLES[reason]
  return (
    <Badge variant="outline" className={cn('font-mono text-[11px]', style.className, className)}>
      {style.label}
    </Badge>
  )
}

function variantIndexOf(result: PlaygroundFlagResult): number {
  const key = result.details.variant
  if (!key || !result.flag) return 0
  return Math.max(
    0,
    result.flag.variants.findIndex((v) => v.key === key),
  )
}

function ruleLabel(result: PlaygroundFlagResult): string | null {
  if (!result.rule) return null
  const n = result.rule.index + 1
  return result.rule.description ? `Rule ${n}: ${result.rule.description}` : `Rule ${n}`
}

function ConditionList({ result }: { result: PlaygroundFlagResult }) {
  const rule = result.rule
  if (!rule) return null
  if (rule.conditions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This rule has no conditions, so it matches every context.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-1">
      {rule.conditions.map((condition, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no id and never reorder here
          key={index}
          className="flex flex-wrap items-center gap-1.5 text-xs"
        >
          <span className="text-muted-foreground">{index === 0 ? 'When' : 'and'}</span>
          {condition.type === 'segment' ? (
            <>
              <span>{condition.negate ? 'not in segment' : 'in segment'}</span>
              <Badge variant="secondary" className="font-normal">
                {result.segmentNames[condition.segmentKey] ?? condition.segmentKey}
              </Badge>
            </>
          ) : (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {describeCondition(condition)}
            </code>
          )}
        </li>
      ))}
    </ul>
  )
}

function BucketBar({ result }: { result: PlaygroundFlagResult }) {
  const bucket = result.details.bucket
  if (!result.variations || !result.flag) return null
  const position = bucket === undefined ? undefined : Math.min(Math.max(bucket, 0), 100)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative pt-5">
        {position !== undefined ? (
          <div
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
            style={{ left: `${position}%` }}
          >
            <span className="tabular rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] leading-none text-background">
              {formatPercent(position)}
            </span>
            <span aria-hidden="true" className="h-1.5 w-px bg-foreground" />
          </div>
        ) : null}
        <RolloutBar
          variations={result.variations}
          variants={result.flag.variants}
          type={result.flag.type}
          height={20}
          showLabels
        />
      </div>
    </div>
  )
}

function Explanation({
  result,
  environment,
}: {
  result: PlaygroundFlagResult
  environment: EnvironmentLike
}) {
  const { details } = result
  const label = ruleLabel(result)
  switch (details.reason) {
    case 'DISABLED':
      return (
        <p className="text-sm">
          The flag is off in <strong>{environment.name}</strong>; the off variant was served.
        </p>
      )
    case 'TARGETING_MATCH':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <strong>Rule {(result.rule?.index ?? 0) + 1}</strong> matched
            {result.rule?.description ? `: ${result.rule.description}` : '.'}
          </p>
          <ConditionList result={result} />
        </div>
      )
    case 'SPLIT':
      return (
        <div className="flex flex-col gap-3">
          {result.servedBy === 'rule' ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                <strong>{label}</strong> matched and serves a rollout.
              </p>
              <ConditionList result={result} />
            </div>
          ) : null}
          {result.servedBy === 'experiment' ? (
            <p className="text-sm">
              Allocated by experiment{' '}
              <code className="rounded bg-muted px-1 font-mono text-xs">
                {details.experimentKey}
              </code>
              .
            </p>
          ) : null}
          <p className="text-sm">
            Rollout: this context lands in bucket{' '}
            <strong className="tabular">
              {details.bucket === undefined ? '?' : formatPercent(details.bucket)}
            </strong>{' '}
            (sticky per{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">{result.bucketBy}</code>
            ).
          </p>
          <BucketBar result={result} />
        </div>
      )
    case 'STATIC':
      return <p className="text-sm">No rule matched; the default was served.</p>
    case 'ERROR':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <code className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-xs text-destructive">
              {details.errorCode ?? 'GENERAL'}
            </code>{' '}
            {details.errorMessage}
          </p>
          {details.errorCode === 'TARGETING_KEY_MISSING' ? (
            <p className="text-xs text-muted-foreground">
              Add a targeting key in the context. Rollouts and per-user rules need one to decide who
              gets what.
            </p>
          ) : null}
          {details.errorCode === 'FLAG_NOT_FOUND' ? (
            <p className="text-xs text-muted-foreground">
              The flag is archived or does not exist in this environment.
            </p>
          ) : null}
        </div>
      )
  }
}

function BigValue({ result }: { result: PlaygroundFlagResult }) {
  const type = result.flag?.type ?? 'json'
  const value = result.details.value
  const pretty =
    typeof value === 'object' && value !== null
      ? JSON.stringify(value, null, 2)
      : formatVariantValue(value, type, { maxLength: 200 })
  const color = variantColor(variantIndexOf(result))
  return (
    <div className="flex items-stretch gap-3">
      <span
        aria-hidden="true"
        className="w-1 shrink-0 rounded-full"
        style={{
          backgroundColor: result.details.reason === 'ERROR' ? 'var(--destructive)' : color,
        }}
      />
      <pre
        className={cn(
          'min-w-0 whitespace-pre-wrap break-all font-mono text-3xl font-semibold leading-tight',
          result.details.reason === 'ERROR' && 'text-muted-foreground',
        )}
      >
        {pretty}
      </pre>
    </div>
  )
}

/** Result card for one flag. Fades and slides in on each new evaluation. */
export function SingleResult({
  result,
  environment,
  evaluationId,
  stale,
}: {
  result: PlaygroundFlagResult
  environment: EnvironmentLike
  /** Changes with every evaluation so the card animates in again. */
  evaluationId: number
  stale?: boolean
}) {
  const type = result.flag?.type
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        key={`${result.flagKey}:${evaluationId}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: stale ? 0.6 : 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <Card>
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-mono text-sm">{result.flagKey}</CardTitle>
              {type ? <FlagTypeBadge type={type} /> : null}
              <EnvBadge env={environment} className="ml-auto" />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <BigValue result={result} />
              <div className="flex flex-wrap items-center gap-2">
                {result.details.variant && result.flag ? (
                  <VariantValue
                    value={result.details.value}
                    type={result.flag.type}
                    variantKey={result.details.variant}
                    index={variantIndexOf(result)}
                    hideValue
                  />
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">no variant</span>
                )}
                <ReasonBadge reason={result.details.reason} />
              </div>
            </div>
            <div
              className={cn(
                'rounded-md border p-3',
                result.details.reason === 'ERROR' && 'border-destructive/40 bg-destructive/5',
              )}
            >
              <Explanation result={result} environment={environment} />
            </div>
            {result.matchedSegments.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Matched segments</span>
                <div className="flex flex-wrap gap-1.5">
                  {result.matchedSegments.map((segment) => (
                    <Badge key={segment.key} variant="secondary" className="font-normal">
                      {segment.name}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {segment.key}
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </motion.div>
    </MotionConfig>
  )
}

/** Table of every flag's resolution. Clicking a row opens that flag's single view. */
export function AllFlagsResult({
  results,
  onSelect,
  stale,
}: {
  results: PlaygroundFlagResult[]
  onSelect: (flagKey: string) => void
  stale?: boolean
}) {
  if (results.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FlaskConicalIcon />
          </EmptyMedia>
          <EmptyTitle>No flags in this environment</EmptyTitle>
          <EmptyDescription>Archived flags are not evaluated.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const errors = results.filter((r) => r.details.reason === 'ERROR').length
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: stale ? 0.6 : 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex flex-col gap-2"
      >
        <p className="text-xs text-muted-foreground">
          {pluralize(results.length, 'flag')} evaluated
          {errors > 0 ? `, ${pluralize(errors, 'error')}` : ''}. Select a row for details.
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flag</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Matched rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result) => (
                <TableRow
                  key={result.flagKey}
                  onClick={() => onSelect(result.flagKey)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(result.flagKey)
                      }}
                      className="rounded-sm font-mono text-[13px] font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {result.flagKey}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-36">
                    <span className="block truncate font-mono text-xs">
                      {formatVariantValue(result.details.value, result.flag?.type ?? 'json', {
                        maxLength: 24,
                      })}
                    </span>
                  </TableCell>
                  <TableCell>
                    {result.details.variant && result.flag ? (
                      <VariantValue
                        value={result.details.value}
                        type={result.flag.type}
                        variantKey={result.details.variant}
                        index={variantIndexOf(result)}
                        hideValue
                      />
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ReasonBadge reason={result.details.reason} />
                  </TableCell>
                  <TableCell className="max-w-40 text-xs">
                    {result.details.reason === 'ERROR' ? (
                      <span className="font-mono text-destructive">{result.details.errorCode}</span>
                    ) : result.rule ? (
                      <span className="block truncate">
                        <span className="tabular font-medium">#{result.rule.index + 1}</span>{' '}
                        <span className="text-muted-foreground">{result.rule.description}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </motion.div>
    </MotionConfig>
  )
}

export function ResultEmpty({ children }: { children?: ReactNode }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FlaskConicalIcon />
        </EmptyMedia>
        <EmptyTitle>No result yet</EmptyTitle>
        <EmptyDescription>
          Fill in a context and choose Evaluate. Playground runs never count towards metrics or
          experiment exposure.
        </EmptyDescription>
      </EmptyHeader>
      {children}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Shortcut <Kbd>⌘</Kbd>
        <Kbd>↵</Kbd>
      </p>
    </Empty>
  )
}

export function ResultSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-6" role="status" aria-busy="true">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-10 w-32" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

export function ResultError({ message }: { message: string }) {
  return (
    <Empty className="border border-dashed border-destructive/40">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>Could not evaluate</EmptyTitle>
        <EmptyDescription className="font-mono text-xs break-words">{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function BackToAll({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} className="self-start">
      <ArrowLeftIcon /> All flags
    </Button>
  )
}
