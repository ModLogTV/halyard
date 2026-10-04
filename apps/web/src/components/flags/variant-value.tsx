import type { FlagType, JsonValue, Variant } from '@halyard/engine'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatVariantValue } from '@/lib/format'
import { cn } from '@/lib/utils'

const PALETTE_SIZE = 5

/** CSS colour for the variant at `index`; cycles through `--chart-1..5`. */
export function variantColor(index: number): string {
  const safe = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0
  return `var(--chart-${(safe % PALETTE_SIZE) + 1})`
}

function hashIndex(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return hash
}

/** Index of `key` in `variants`, or -1. */
export function variantIndex(variants: Pick<Variant, 'key'>[], key: string): number {
  return variants.findIndex((variant) => variant.key === key)
}

export interface VariantValueProps {
  value: JsonValue
  type: FlagType
  variantKey?: string
  /** Position of the variant in the flag's variant list; drives the colour. Falls back to a hash of the key. */
  index?: number
  /** Hide the formatted value and show only the key. */
  hideValue?: boolean
  className?: string
}

/** Compact mono chip: coloured dot, variant key and the muted formatted value. */
export function VariantValue({
  value,
  type,
  variantKey,
  index,
  hideValue,
  className,
}: VariantValueProps) {
  const formatted = formatVariantValue(value, type)
  const colorIndex = index ?? (variantKey ? hashIndex(variantKey) : 0)
  // Don't repeat the value when it is identical to the key (common for string flags).
  const showValue = !hideValue && (variantKey === undefined || formatted !== variantKey)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 font-mono text-xs', className)}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: variantColor(colorIndex) }}
      />
      {variantKey !== undefined ? (
        <span className="truncate font-medium text-foreground">{variantKey}</span>
      ) : null}
      {showValue ? (
        <span
          className={cn(
            'truncate',
            variantKey !== undefined ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {formatted}
        </span>
      ) : null}
    </span>
  )
}

export interface VariantSelectProps {
  variants: Variant[]
  /** The type of the flag, used to format values. */
  type?: FlagType
  value: string
  onValueChange: (variantKey: string) => void
  disabled?: boolean
  placeholder?: string
  id?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  className?: string
}

/** shadcn `Select` whose options are rendered as {@link VariantValue} chips. */
export function VariantSelect({
  variants,
  type = 'string',
  value,
  onValueChange,
  disabled,
  placeholder = 'Select a variant',
  id,
  className,
  ...aria
}: VariantSelectProps) {
  const known = variants.some((variant) => variant.key === value)
  return (
    <Select value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className={cn('w-full min-w-0', className)} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {variants.map((variant, index) => (
          <SelectItem key={variant.key} value={variant.key}>
            <VariantValue
              value={variant.value}
              type={type}
              variantKey={variant.key}
              index={index}
            />
          </SelectItem>
        ))}
        {value && !known ? (
          <SelectItem value={value} disabled>
            <span className="font-mono text-xs text-destructive">{value} (missing)</span>
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  )
}
