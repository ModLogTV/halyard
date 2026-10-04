import { useTranslation } from 'react-i18next'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { HEX_COLOR_PATTERN } from '@/server/schemas/common'

export const ENVIRONMENT_COLOR_PRESETS = [
  { name: 'blue', value: '#3b82f6' },
  { name: 'amber', value: '#f59e0b' },
  { name: 'red', value: '#ef4444' },
  { name: 'green', value: '#22c55e' },
  { name: 'violet', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' },
  { name: 'teal', value: '#14b8a6' },
  { name: 'slate', value: '#64748b' },
] as const

export const DEFAULT_ENVIRONMENT_COLOR = '#64748b'

/** Native colour input, a hex field and a row of preset swatches. */
export function ColorField({
  id,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation('settings')
  const valid = HEX_COLOR_PATTERN.test(value)
  const preset = ENVIRONMENT_COLOR_PRESETS.find((p) => p.value === value.toLowerCase())

  return (
    <div className="flex flex-col gap-3">
      <InputGroup>
        <InputGroupAddon>
          <input
            type="color"
            aria-label={t('environments.colorField.pick')}
            value={valid ? value.toLowerCase() : DEFAULT_ENVIRONMENT_COLOR}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            className="size-6 cursor-pointer appearance-none rounded border-0 bg-transparent p-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border [&::-webkit-color-swatch-wrapper]:p-0"
          />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
          placeholder="#3b82f6"
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className="font-mono"
        />
      </InputGroup>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={2}
        value={preset?.value ?? ''}
        onValueChange={(next) => {
          if (next) onChange(next)
        }}
        disabled={disabled}
        aria-label={t('environments.colorField.presets')}
        className="flex-wrap"
      >
        {ENVIRONMENT_COLOR_PRESETS.map((p) => (
          <ToggleGroupItem
            key={p.value}
            value={p.value}
            aria-label={t(`environments.colorField.${p.name}`)}
            title={t(`environments.colorField.${p.name}`)}
            className="size-8 min-w-8 rounded-md px-0 data-[state=on]:border-ring data-[state=on]:ring-[3px] data-[state=on]:ring-ring/30"
          >
            <span
              aria-hidden="true"
              className="size-4 rounded-full"
              style={{ backgroundColor: p.value }}
            />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
