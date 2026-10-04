import type { FlagType } from '@halyard/engine'
import { ListFilterIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export const FLAG_TYPES: FlagType[] = ['boolean', 'string', 'number', 'json']

export interface FlagFilterState {
  types: FlagType[]
  tags: string[]
  stale: boolean
  archived: boolean
}

interface FlagFiltersProps {
  value: FlagFilterState
  allTags: string[]
  staleCount: number
  staleHelp: string
  onChange: (patch: Partial<FlagFilterState>) => void
  onClear: () => void
}

function toggleIn<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

/**
 * One icon button that opens a searchable multi-select for every list filter,
 * followed by removable chips for the filters currently applied.
 */
export function FlagFilters({
  value,
  allTags,
  staleCount,
  staleHelp,
  onChange,
  onClear,
}: FlagFiltersProps) {
  const { t } = useTranslation(['flags', 'common'])
  const [open, setOpen] = useState(false)
  const activeCount =
    value.types.length + value.tags.length + (value.stale ? 1 : 0) + (value.archived ? 1 : 0)
  const label =
    activeCount > 0
      ? t('list.filters.buttonActive', { count: activeCount })
      : t('list.filters.button')

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={label}
                aria-expanded={open}
                data-active={activeCount > 0}
                className="relative data-[active=true]:border-foreground/30"
              >
                <ListFilterIcon />
                {activeCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="tabular absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground"
                  >
                    {activeCount}
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="w-64 p-0">
          <Command>
            <CommandInput placeholder={t('list.filters.searchFilters')} />
            <CommandList>
              <CommandEmpty>{t('list.filters.noFilterMatches')}</CommandEmpty>
              <CommandGroup heading={t('list.filters.typeGroup')}>
                {FLAG_TYPES.map((type) => (
                  <CommandItem
                    key={type}
                    value={`type ${t(`common:flagTypes.${type}`)}`}
                    data-checked={value.types.includes(type)}
                    onSelect={() => onChange({ types: toggleIn(value.types, type) })}
                  >
                    {t(`common:flagTypes.${type}`)}
                  </CommandItem>
                ))}
              </CommandGroup>
              {allTags.length > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={t('list.filters.tagGroup')}>
                    {allTags.map((tag) => (
                      <CommandItem
                        key={tag}
                        value={`tag ${tag}`}
                        data-checked={value.tags.includes(tag)}
                        onSelect={() => onChange({ tags: toggleIn(value.tags, tag) })}
                      >
                        <span className="truncate font-mono text-xs">{tag}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : null}
              <CommandSeparator />
              <CommandGroup heading={t('list.filters.showGroup')}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CommandItem
                      value={`show ${t('list.filters.stale')}`}
                      data-checked={value.stale}
                      onSelect={() => onChange({ stale: !value.stale })}
                    >
                      {t('list.filters.stale')}
                      {staleCount > 0 ? (
                        <span className="tabular text-muted-foreground text-xs">{staleCount}</span>
                      ) : null}
                    </CommandItem>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-64">
                    {staleHelp}
                  </TooltipContent>
                </Tooltip>
                <CommandItem
                  value={`show ${t('list.filters.archived')}`}
                  data-checked={value.archived}
                  onSelect={() => onChange({ archived: !value.archived })}
                >
                  {t('list.filters.archived')}
                </CommandItem>
              </CommandGroup>
              {activeCount > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="clear all filters"
                      onSelect={() => {
                        onClear()
                        setOpen(false)
                      }}
                      className="justify-center text-muted-foreground"
                    >
                      {t('list.filters.clearAll')}
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.types.map((type) => (
        <FilterChip
          key={`type-${type}`}
          label={t(`common:flagTypes.${type}`)}
          onRemove={() => onChange({ types: value.types.filter((x) => x !== type) })}
        />
      ))}
      {value.tags.map((tag) => (
        <FilterChip
          key={`tag-${tag}`}
          label={tag}
          mono
          onRemove={() => onChange({ tags: value.tags.filter((x) => x !== tag) })}
        />
      ))}
      {value.stale ? (
        <FilterChip label={t('list.filters.stale')} onRemove={() => onChange({ stale: false })} />
      ) : null}
      {value.archived ? (
        <FilterChip
          label={t('list.filters.archived')}
          onRemove={() => onChange({ archived: false })}
        />
      ) : null}
    </div>
  )
}

function FilterChip({
  label,
  mono,
  onRemove,
}: {
  label: string
  mono?: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation('flags')
  return (
    <Badge variant="secondary" className="h-7 gap-1 pr-1 pl-2.5">
      <span className={mono ? 'font-mono text-xs' : undefined}>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('list.filters.removeFilter', { filter: label })}
        className="flex size-5 items-center justify-center rounded-full hover:bg-foreground/10"
      >
        <XIcon className="size-3" />
      </button>
    </Badge>
  )
}
