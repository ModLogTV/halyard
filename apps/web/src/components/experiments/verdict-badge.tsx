import type { TFunction } from 'i18next'
import { CircleHelpIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  MIN_CONVERSIONS_PER_VARIANT,
  MIN_EXPOSURES_PER_VARIANT,
  SIGNIFICANCE_LEVEL,
  type Verdict,
} from '@/server/experiments/stats'

export function minimumSampleRule(t: TFunction<['experiments', 'common']>): string {
  return t('verdict.minimumSample', {
    exposures: MIN_EXPOSURES_PER_VARIANT,
    conversions: MIN_CONVERSIONS_PER_VARIANT,
  })
}

/** Winner green, loser red, no difference muted, insufficient data an outline with the sample rule. */
export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  const { t } = useTranslation(['experiments', 'common'])
  switch (verdict) {
    case 'winner':
      return (
        <Badge className="gap-1 border-on/30 bg-on-soft text-foreground">
          <TrendingUpIcon className="text-on" /> {t('verdict.winner')}
        </Badge>
      )
    case 'loser':
      return (
        <Badge className="gap-1 border-destructive/30 bg-destructive/10 text-destructive">
          <TrendingDownIcon /> {t('verdict.loser')}
        </Badge>
      )
    case 'no-difference':
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          {t('verdict.noDifference')}
        </Badge>
      )
    case 'insufficient-data':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              {t('verdict.insufficientData')} <CircleHelpIcon />
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {t('verdict.insufficientTooltip', {
              rule: minimumSampleRule(t),
              level: SIGNIFICANCE_LEVEL,
            })}
          </TooltipContent>
        </Tooltip>
      )
    default:
      return <span className="text-muted-foreground">—</span>
  }
}
