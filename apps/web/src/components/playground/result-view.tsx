import type { ResolutionReason } from '@modlogtv/halyard-engine'
import type { TFunction } from 'i18next'
import { ArrowLeftIcon, FlaskConicalIcon, TriangleAlertIcon } from 'lucide-react'
import { MotionConfig, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
import { formatPercent, formatVariantValue } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PlaygroundFlagResult } from '@/server/functions/playground'

/** `t` as returned by `useTranslation(['playground', 'segments', 'flags', 'common'])`. */
type PlaygroundT = TFunction<['playground', 'segments', 'common']>

const REASON_STYLES: Record<
  ResolutionReason,
  { key: 'disabled' | 'targetingMatch' | 'split' | 'static' | 'error'; className: string }
> = {
  DISABLED: { key: 'disabled', className: 'border-border bg-muted text-muted-foreground' },
  TARGETING_MATCH: {
    key: 'targetingMatch',
    className: 'border-transparent bg-on-soft text-foreground',
  },
  SPLIT: { key: 'split', className: 'border-transparent bg-info-soft text-foreground' },
  STATIC: { key: 'static', className: 'border-border bg-secondary text-secondary-foreground' },
  ERROR: { key: 'error', className: 'border-transparent bg-destructive/10 text-destructive' },
}

export function ReasonBadge({
  reason,
  className,
}: {
  reason: ResolutionReason
  className?: string
}) {
  const { t } = useTranslation('playground')
  const style = REASON_STYLES[reason]
  return (
    <Badge variant="outline" className={cn('font-mono text-[11px]', style.className, className)}>
      {t(`reasons.${style.key}`)}
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

function ruleLabel(result: PlaygroundFlagResult, t: PlaygroundT): string | null {
  if (!result.rule) return null
  const number = result.rule.index + 1
  return result.rule.description
    ? t('explain.ruleWithDescription', { number, description: result.rule.description })
    : t('explain.rule', { number })
}

function ConditionList({ result }: { result: PlaygroundFlagResult }) {
  const { t } = useTranslation(['playground', 'segments', 'flags', 'common'])
  const rule = result.rule
  if (!rule) return null
  if (rule.conditions.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('explain.noConditions')}</p>
  }
  return (
    <ul className="flex flex-col gap-1">
      {rule.conditions.map((condition, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no id and never reorder here
          key={index}
          className="flex flex-wrap items-center gap-1.5 text-xs"
        >
          <span className="text-muted-foreground">
            {index === 0 ? t('explain.when') : t('explain.and')}
          </span>
          {condition.type === 'segment' ? (
            <>
              <span>{condition.negate ? t('explain.notInSegment') : t('explain.inSegment')}</span>
              <Badge variant="secondary" className="font-normal">
                {result.segmentNames[condition.segmentKey] ?? condition.segmentKey}
              </Badge>
            </>
          ) : (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {describeCondition(condition, t)}
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
  const { t } = useTranslation(['playground', 'segments', 'flags', 'common'])
  const { details } = result
  const label = ruleLabel(result, t)
  switch (details.reason) {
    case 'DISABLED':
      return (
        <p className="text-sm">
          <Trans
            t={t}
            i18nKey="explain.disabled"
            values={{ environment: environment.name }}
            components={[<strong key="environment" />]}
          />
        </p>
      )
    case 'TARGETING_MATCH':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <Trans
              t={t}
              i18nKey={
                result.rule?.description
                  ? 'explain.targetingMatchDescribed'
                  : 'explain.targetingMatch'
              }
              values={{
                number: (result.rule?.index ?? 0) + 1,
                description: result.rule?.description,
              }}
              components={[<strong key="rule" />]}
            />
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
                <Trans
                  t={t}
                  i18nKey="explain.splitRule"
                  values={{ label }}
                  components={[<strong key="label" />]}
                />
              </p>
              <ConditionList result={result} />
            </div>
          ) : null}
          {result.servedBy === 'experiment' ? (
            <p className="text-sm">
              <Trans
                t={t}
                i18nKey="explain.splitExperiment"
                values={{ key: details.experimentKey }}
                components={[
                  <code key="key" className="rounded bg-muted px-1 font-mono text-xs" />,
                ]}
              />
            </p>
          ) : null}
          <p className="text-sm">
            <Trans
              t={t}
              i18nKey="explain.splitBucket"
              values={{
                bucket: details.bucket === undefined ? '?' : formatPercent(details.bucket),
                bucketBy: result.bucketBy,
              }}
              components={[
                <strong key="bucket" className="tabular" />,
                <code key="bucketBy" className="rounded bg-muted px-1 font-mono text-xs" />,
              ]}
            />
          </p>
          <BucketBar result={result} />
        </div>
      )
    case 'STATIC':
      return <p className="text-sm">{t('explain.static')}</p>
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
            <p className="text-xs text-muted-foreground">{t('explain.targetingKeyMissing')}</p>
          ) : null}
          {details.errorCode === 'FLAG_NOT_FOUND' ? (
            <p className="text-xs text-muted-foreground">{t('explain.flagNotFound')}</p>
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
  const { t } = useTranslation('playground')
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
                  <span className="font-mono text-xs text-muted-foreground">
                    {t('result.noVariant')}
                  </span>
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
                <span className="text-xs font-medium text-muted-foreground">
                  {t('result.matchedSegments')}
                </span>
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
  const { t } = useTranslation(['playground', 'common'])
  if (results.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FlaskConicalIcon />
          </EmptyMedia>
          <EmptyTitle>{t('all.empty.title')}</EmptyTitle>
          <EmptyDescription>{t('all.empty.description')}</EmptyDescription>
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
          {errors > 0
            ? t('all.summaryWithErrors', {
                flags: t('common:counts.flags', { count: results.length }),
                errors: t('all.errors', { count: errors }),
              })
            : t('all.summary', { flags: t('common:counts.flags', { count: results.length }) })}
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:labels.flag')}</TableHead>
                <TableHead>{t('common:labels.value')}</TableHead>
                <TableHead>{t('common:labels.variant')}</TableHead>
                <TableHead>{t('common:labels.reason')}</TableHead>
                <TableHead>{t('all.columns.matchedRule')}</TableHead>
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
  const { t } = useTranslation('playground')
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FlaskConicalIcon />
        </EmptyMedia>
        <EmptyTitle>{t('result.empty.title')}</EmptyTitle>
        <EmptyDescription>{t('result.empty.description')}</EmptyDescription>
      </EmptyHeader>
      {children}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {t('result.empty.shortcut')} <Kbd>⌘</Kbd>
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
  const { t } = useTranslation('playground')
  return (
    <Empty className="border border-dashed border-destructive/40">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>{t('result.error.title')}</EmptyTitle>
        <EmptyDescription className="font-mono text-xs break-words">{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function BackToAll({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('playground')
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} className="self-start">
      <ArrowLeftIcon /> {t('result.backToAll')}
    </Button>
  )
}
