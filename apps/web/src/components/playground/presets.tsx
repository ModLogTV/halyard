import { BookmarkPlusIcon, XIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BUILT_IN_PRESETS, type ContextPreset } from './context'

const BUILT_IN_KEYS: Record<string, 'beta' | 'eu' | 'free' | 'anonymous'> = {
  'builtin:beta': 'beta',
  'builtin:eu': 'eu',
  'builtin:free': 'free',
  'builtin:anonymous': 'anonymous',
}

function PresetChip({
  preset,
  onApply,
  onDelete,
}: {
  preset: ContextPreset
  onApply: (preset: ContextPreset) => void
  onDelete?: (preset: ContextPreset) => void
}) {
  const { t } = useTranslation('playground')
  return (
    <span className="inline-flex items-center rounded-full border bg-background text-xs">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onApply(preset)}
            className="rounded-full py-1 pr-2.5 pl-2.5 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={onDelete ? { paddingRight: 4 } : undefined}
          >
            {preset.name}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {preset.description ?? t('presets.fallbackDescription', { name: preset.name })}
        </TooltipContent>
      </Tooltip>
      {onDelete ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('presets.deleteLabel', { name: preset.name })}
              onClick={() => onDelete(preset)}
              className="mr-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('presets.delete')}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  )
}

export function PresetChips({
  saved,
  onApply,
  onDelete,
}: {
  saved: ContextPreset[]
  onApply: (preset: ContextPreset) => void
  onDelete: (preset: ContextPreset) => void
}) {
  const { t } = useTranslation('playground')
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t('presets.title')}</span>
      <div className="flex flex-wrap gap-1.5">
        {BUILT_IN_PRESETS.map((preset) => {
          const key = BUILT_IN_KEYS[preset.id]
          // Built-in presets are translated; the context itself stays as defined.
          const localized: ContextPreset = key
            ? {
                ...preset,
                name: t(`presets.builtin.${key}.name`),
                description: t(`presets.builtin.${key}.description`),
              }
            : preset
          return <PresetChip key={preset.id} preset={localized} onApply={onApply} />
        })}
        {saved.map((preset) => (
          <PresetChip key={preset.id} preset={preset} onApply={onApply} onDelete={onDelete} />
        ))}
      </div>
      {saved.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('presets.savedHint')}</p>
      ) : null}
    </div>
  )
}

export function SavePresetButton({
  disabled,
  onSave,
}: {
  disabled?: boolean
  onSave: (name: string) => void
}) {
  const { t } = useTranslation('playground')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const id = useId()
  const trimmed = name.trim()

  function submit() {
    if (!trimmed) return
    onSave(trimmed)
    setName('')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <BookmarkPlusIcon /> {t('presets.save')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor={id} className="text-sm font-medium">
            {t('presets.nameLabel')}
          </label>
          <Input
            id={id}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('presets.namePlaceholder')}
            maxLength={40}
            autoComplete="off"
          />
          <Button type="submit" size="sm" disabled={!trimmed}>
            {t('presets.submit')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
