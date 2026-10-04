import type { FlagType, RolloutVariation, Variant } from '@modlogtv/halyard-engine'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatPercent, formatVariantValue } from '@/lib/format'
import { cn } from '@/lib/utils'
import { variantColor, variantIndex } from './variant-value'

/** Segments at least this wide (percent of the bar) get an inline label. */
const LABEL_MIN_WIDTH = 14

export interface RolloutBarProps {
  variations: RolloutVariation[]
  variants: Variant[]
  /** Bar height in px. Defaults to 8, or 20 when `showLabels` is set. */
  height?: number
  /** Show variant keys inside segments wide enough to hold them. */
  showLabels?: boolean
  /** Used to format values in tooltips. */
  type?: FlagType
  className?: string
}

/**
 * Horizontal stacked bar for a percentage rollout, coloured by variant. Weights that
 * add up to less than 100 leave a hatched gap; more than 100 are scaled down to fit.
 */
export function RolloutBar({
  variations,
  variants,
  height,
  showLabels = false,
  type = 'string',
  className,
}: RolloutBarProps) {
  const { t } = useTranslation('flags')
  const barHeight = height ?? (showLabels ? 20 : 8)
  const segments = variations
    .map((variation) => ({
      ...variation,
      weight: Number.isFinite(variation.weight) && variation.weight > 0 ? variation.weight : 0,
    }))
    .filter((variation) => variation.weight > 0)
  const total = segments.reduce((sum, segment) => sum + segment.weight, 0)
  const scale = Math.max(total, 100)

  const summary = segments.length
    ? segments.map((s) => `${s.variant} ${formatPercent(s.weight)}`).join(', ')
    : t('rolloutBar.noTraffic')

  return (
    <TooltipProvider delayDuration={100}>
      <div
        role="img"
        aria-label={summary}
        className={cn(
          'flex w-full overflow-hidden rounded-full bg-muted ring-1 ring-border ring-inset',
          className,
        )}
        style={{ height: barHeight }}
      >
        {segments.map((segment) => {
          const index = variantIndex(variants, segment.variant)
          const variant = variants[index]
          const width = (segment.weight / scale) * 100
          return (
            <Tooltip key={segment.variant}>
              <TooltipTrigger asChild>
                <div
                  className="flex min-w-0 items-center justify-center border-background border-r transition-[width] duration-200 last:border-r-0"
                  style={{
                    width: `${width}%`,
                    backgroundColor: variantColor(index < 0 ? 0 : index),
                  }}
                >
                  {showLabels && width >= LABEL_MIN_WIDTH ? (
                    <span className="mx-1 max-w-full truncate rounded-sm bg-background/85 px-1 font-mono text-[10px] leading-4 text-foreground">
                      {segment.variant}
                    </span>
                  ) : null}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="font-mono">{segment.variant}</span>
                <span className="tabular ml-2">{formatPercent(segment.weight)}</span>
                {variant ? (
                  <span className="ml-2 font-mono opacity-70">
                    {formatVariantValue(variant.value, type, { maxLength: 24 })}
                  </span>
                ) : null}
              </TooltipContent>
            </Tooltip>
          )
        })}
        {total < 100 - 1e-6 ? (
          <div
            className="min-w-0 flex-1 bg-[repeating-linear-gradient(-45deg,transparent_0_3px,var(--border)_3px_4px)]"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </TooltipProvider>
  )
}
