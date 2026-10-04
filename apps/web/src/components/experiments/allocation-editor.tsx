import type { RolloutVariation } from '@halyard/engine'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { evenSplit, RolloutBar, VariantValue } from '@/components/flags'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { allocationIsComplete, allocationTotal, type FlagOption } from './utils'

export interface AllocationEditorProps {
  flag: FlagOption
  /** One entry per variant of the flag, in flag order. */
  value: RolloutVariation[]
  onChange: (value: RolloutVariation[]) => void
  disabled?: boolean
  /** Variant that is the control; marked in the list. */
  control?: string
}

function parseWeight(text: string): number {
  const n = Number.parseFloat(text.replace(',', '.'))
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

/** Weights per variant of a flag with a live bar, total and "Split evenly". */
export function AllocationEditor({
  flag,
  value,
  onChange,
  disabled,
  control,
}: AllocationEditorProps) {
  const { t } = useTranslation(['experiments', 'common'])
  // Raw text while typing, so "33." and "" survive a render.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const total = allocationTotal(value)
  const complete = allocationIsComplete(value)

  function setWeight(variant: string, text: string) {
    setDrafts((prev) => ({ ...prev, [variant]: text }))
    onChange(value.map((v) => (v.variant === variant ? { ...v, weight: parseWeight(text) } : v)))
  }

  function splitEvenly() {
    setDrafts({})
    onChange(evenSplit(flag.variants.map((v) => v.key)))
  }

  return (
    <div className="flex flex-col gap-3">
      <RolloutBar
        variations={value}
        variants={flag.variants}
        type={flag.type}
        showLabels
        height={20}
      />
      <ul className="flex flex-col gap-2">
        {flag.variants.map((variant, index) => {
          const weight = value.find((v) => v.variant === variant.key)?.weight ?? 0
          const inputId = `allocation-${variant.key}`
          return (
            <li key={variant.key} className="flex items-center gap-3">
              <label htmlFor={inputId} className="flex min-w-0 flex-1 items-center gap-2">
                <VariantValue
                  value={variant.value}
                  type={flag.type}
                  variantKey={variant.key}
                  index={index}
                  className="min-w-0 truncate"
                />
                {control === variant.key ? (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    {t('badges.control')}
                  </span>
                ) : null}
              </label>
              <div className="relative w-28 shrink-0">
                <Input
                  id={inputId}
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={disabled}
                  className="tabular pr-7 text-right"
                  value={drafts[variant.key] ?? String(Number(weight.toFixed(3)))}
                  onChange={(e) => setWeight(variant.key, e.target.value)}
                  onBlur={() =>
                    setDrafts((prev) => {
                      const { [variant.key]: _drop, ...rest } = prev
                      return rest
                    })
                  }
                  aria-label={t('allocation.weightAriaLabel', { variant: variant.key })}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground text-sm"
                >
                  %
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={splitEvenly} disabled={disabled}>
          {t('allocation.splitEvenly')}
        </Button>
        <p
          className={cn('tabular text-sm', complete ? 'text-muted-foreground' : 'text-destructive')}
          role={complete ? undefined : 'alert'}
        >
          {complete
            ? t('allocation.total', { value: formatPercent(total) })
            : t(total < 100 ? 'allocation.totalAdd' : 'allocation.totalRemove', {
                value: formatPercent(total),
                delta: formatPercent(Math.abs(100 - total)),
              })}
        </p>
      </div>
    </div>
  )
}
