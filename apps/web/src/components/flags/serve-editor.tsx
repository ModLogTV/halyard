import type { FlagDefinition, RolloutVariation, Serve } from '@modlogtv/halyard-engine'
import { WEIGHT_TOLERANCE } from '@modlogtv/halyard-engine'
import { CheckIcon, ChevronRightIcon, CircleAlertIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RolloutBar } from './rollout-bar'
import { evenSplit, primaryVariant, rolloutFrom, sumWeights } from './serve-utils'
import { VariantSelect, VariantValue } from './variant-value'

export interface ServeEditorProps {
  flag: Pick<FlagDefinition, 'type' | 'variants'>
  value: Serve
  onChange: (value: Serve) => void
  disabled?: boolean
  /** Small heading shown above the editor, e.g. "Serve". */
  label?: string
  /** Offer the "Percentage rollout" mode. Defaults to true. */
  allowRollout?: boolean
  className?: string
}

export function ServeEditor({
  flag,
  value,
  onChange,
  disabled,
  label,
  allowRollout = true,
  className,
}: ServeEditorProps) {
  const { t } = useTranslation(['flags', 'common'])
  const baseId = useId()
  // The rollout the user started from, so "Reset" has something sensible to go back to.
  const baseline = useRef<RolloutVariation[] | null>(
    value.type === 'rollout' ? value.variations : null,
  )

  function switchMode(next: string) {
    if (next === value.type || (next !== 'variant' && next !== 'rollout')) return
    if (next === 'variant') {
      onChange({ type: 'variant', variant: primaryVariant(value, flag.variants) })
      return
    }
    const rollout = rolloutFrom(flag.variants, value.type === 'variant' ? value.variant : undefined)
    baseline.current = rollout.variations
    onChange(rollout)
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {label || allowRollout ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {label ? (
            <span id={`${baseId}-label`} className="font-medium text-muted-foreground text-xs">
              {label}
            </span>
          ) : (
            <span />
          )}
          {allowRollout ? (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={value.type}
              onValueChange={switchMode}
              disabled={disabled}
              aria-label={label ? t('serve.modeLabelNamed', { label }) : t('serve.modeLabel')}
            >
              <ToggleGroupItem value="variant" className="h-7 px-2.5 text-xs">
                {t('serve.modes.variant')}
              </ToggleGroupItem>
              <ToggleGroupItem value="rollout" className="h-7 px-2.5 text-xs">
                {t('serve.modes.rollout')}
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </div>
      ) : null}

      {value.type === 'variant' ? (
        <VariantSelect
          variants={flag.variants}
          type={flag.type}
          value={value.variant}
          onValueChange={(variant) => onChange({ type: 'variant', variant })}
          disabled={disabled}
          aria-label={label ? t('serve.variantLabelNamed', { label }) : t('serve.variantLabel')}
        />
      ) : (
        <RolloutEditor
          flag={flag}
          value={value}
          onChange={onChange}
          disabled={disabled}
          baseline={baseline}
          baseId={baseId}
        />
      )}
    </div>
  )
}

type RolloutServe = Extract<Serve, { type: 'rollout' }>

function RolloutEditor({
  flag,
  value,
  onChange,
  disabled,
  baseline,
  baseId,
}: {
  flag: Pick<FlagDefinition, 'type' | 'variants'>
  value: RolloutServe
  onChange: (value: Serve) => void
  disabled?: boolean
  baseline: { current: RolloutVariation[] | null }
  baseId: string
}) {
  const { t } = useTranslation(['flags', 'common'])
  const weights = new Map(value.variations.map((v) => [v.variant, v.weight]))
  const known = new Set(flag.variants.map((v) => v.key))
  // One row per flag variant, plus any rollout entry that points at a variant that no longer exists.
  const rows: RolloutVariation[] = [
    ...flag.variants.map((variant) => ({
      variant: variant.key,
      weight: weights.get(variant.key) ?? 0,
    })),
    ...value.variations.filter((v) => !known.has(v.variant)),
  ]
  const total = sumWeights(rows)
  const balanced = Math.abs(total - 100) <= WEIGHT_TOLERANCE
  const diff = Number(Math.abs(100 - total).toFixed(6))
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(value.bucketBy))

  function emit(variations: RolloutVariation[]) {
    onChange({ ...value, variations })
  }

  function setWeight(variantKey: string, weight: number) {
    emit(rows.map((row) => (row.variant === variantKey ? { ...row, weight } : row)))
  }

  function splitEvenly() {
    emit(evenSplit(flag.variants.map((v) => v.key)))
  }

  const reference = baseline.current
  const matchesBaseline =
    reference !== null &&
    rows.length === reference.length &&
    rows.every((row) => reference.find((r) => r.variant === row.variant)?.weight === row.weight)

  function reset() {
    emit(
      reference
        ? reference.map((r) => ({ ...r }))
        : evenSplit(flag.variants.map((variant) => variant.key)),
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const index = flag.variants.findIndex((v) => v.key === row.variant)
          const variant = flag.variants[index]
          const inputId = `${baseId}-w-${row.variant}`
          return (
            <li key={row.variant} className="flex items-center gap-3">
              <Label htmlFor={inputId} className="min-w-0 flex-1 font-normal">
                {variant ? (
                  <VariantValue
                    value={variant.value}
                    type={flag.type}
                    variantKey={variant.key}
                    index={index}
                  />
                ) : (
                  <span className="truncate font-mono text-destructive text-xs">
                    {t('serve.missingVariant', { variant: row.variant })}
                  </span>
                )}
              </Label>
              <WeightInput
                id={inputId}
                label={t('serve.weightFor', { variant: row.variant })}
                value={row.weight}
                onChange={(weight) => setWeight(row.variant, weight)}
                disabled={disabled}
              />
            </li>
          )
        })}
      </ul>

      <RolloutBar variations={rows} variants={flag.variants} type={flag.type} height={8} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          role="status"
          className={cn(
            'tabular flex items-center gap-1.5 text-xs',
            balanced ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          {balanced ? (
            <>
              <CheckIcon className="size-3.5 text-on" aria-hidden="true" />
              {t('serve.balanced')}
            </>
          ) : (
            <>
              <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {t(total < 100 ? 'serve.unbalancedUnder' : 'serve.unbalancedOver', {
                total: formatPercent(total),
                diff: formatPercent(diff),
              })}
            </>
          )}
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="xs" onClick={splitEvenly} disabled={disabled}>
            {t('serve.splitEvenly')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={reset}
            disabled={disabled || matchesBaseline}
          >
            {t('common:actions.reset')}
          </Button>
        </div>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="xs" className="-ml-1.5 text-muted-foreground">
            <ChevronRightIcon
              className={cn('transition-transform duration-150', advancedOpen && 'rotate-90')}
              aria-hidden="true"
            />
            {t('serve.advanced')}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-bucket`} className="text-xs">
              {t('serve.bucketBy')}
            </Label>
            <Input
              id={`${baseId}-bucket`}
              value={value.bucketBy ?? ''}
              placeholder="targetingKey"
              spellCheck={false}
              autoComplete="off"
              disabled={disabled}
              className="h-8 font-mono text-xs"
              onChange={(event) => {
                const { bucketBy: _omit, ...rest } = value
                const next = event.target.value
                onChange(next ? { ...rest, bucketBy: next } : rest)
              }}
            />
            <p className="text-muted-foreground text-xs">{t('serve.bucketByHelp')}</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** Percentage input that lets the user type freely ("", "3.") and normalises on blur. */
function WeightInput({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: number
  onChange: (weight: number) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(() => String(value))

  // Follow external changes (split evenly, reset, mode switch) but not our own typing.
  useEffect(() => {
    setText((current) => {
      const typedIsSame = current === '' ? value === 0 : Number(current) === value
      return typedIsSame ? current : String(value)
    })
  }, [value])

  return (
    <InputGroup className="h-8 w-28 shrink-0">
      <InputGroupInput
        id={id}
        aria-label={label}
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step={0.1}
        value={text}
        disabled={disabled}
        className="tabular text-right font-mono text-xs"
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const parsed = raw === '' ? 0 : Number(raw)
          if (Number.isFinite(parsed)) onChange(Math.min(100, Math.max(0, parsed)))
        }}
        onBlur={() => setText(String(value))}
      />
      <InputGroupAddon align="inline-end" className="text-xs">
        %
      </InputGroupAddon>
    </InputGroup>
  )
}
