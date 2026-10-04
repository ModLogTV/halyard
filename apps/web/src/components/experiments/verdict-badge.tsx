import { CircleHelpIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  MIN_CONVERSIONS_PER_VARIANT,
  MIN_EXPOSURES_PER_VARIANT,
  SIGNIFICANCE_LEVEL,
  type Verdict,
} from '@/server/experiments/stats'

export function minimumSampleRule(): string {
  return `A result needs at least ${MIN_EXPOSURES_PER_VARIANT} exposures and ${MIN_CONVERSIONS_PER_VARIANT} conversions in both the variant and the control.`
}

/** Winner green, loser red, no difference muted, insufficient data an outline with the sample rule. */
export function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  switch (verdict) {
    case 'winner':
      return (
        <Badge className="gap-1 border-on/30 bg-on-soft text-foreground">
          <TrendingUpIcon className="text-on" /> Winner
        </Badge>
      )
    case 'loser':
      return (
        <Badge className="gap-1 border-destructive/30 bg-destructive/10 text-destructive">
          <TrendingDownIcon /> Loser
        </Badge>
      )
    case 'no-difference':
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          No difference
        </Badge>
      )
    case 'insufficient-data':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              Insufficient data <CircleHelpIcon />
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {minimumSampleRule()} Significance is tested at p &lt; {SIGNIFICANCE_LEVEL}.
          </TooltipContent>
        </Tooltip>
      )
    default:
      return <span className="text-muted-foreground">—</span>
  }
}
