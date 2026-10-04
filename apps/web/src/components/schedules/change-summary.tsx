import type { FlagType, Variant } from '@modlogtv/halyard-engine'
import { useTranslation } from 'react-i18next'
import { RolloutBar } from '@/components/flags'
import { cn } from '@/lib/utils'
import { type ScheduledChangeItem, summarizeChange, syntheticVariants } from './utils'

/** One-line summary of what a scheduled change does, with a small bar for rollouts. */
export function ChangeSummary({
  change,
  variants,
  type,
  className,
}: {
  change: ScheduledChangeItem['change']
  variants?: Variant[]
  type?: FlagType
  className?: string
}) {
  const { t } = useTranslation(['schedules', 'common'])
  const { labels, rollout } = summarizeChange(change, t)
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <p className="text-sm font-medium">{labels.join(' · ')}</p>
      {rollout ? (
        <RolloutBar
          variations={rollout}
          variants={variants ?? syntheticVariants(rollout)}
          type={type}
          className="max-w-56"
        />
      ) : null}
    </div>
  )
}
