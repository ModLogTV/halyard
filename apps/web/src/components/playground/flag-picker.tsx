import type { FlagType } from '@modlogtv/halyard-engine'
import { CheckIcon, ChevronsUpDownIcon, ListIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlagTypeBadge } from '@/components/flags/flag-type-badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface FlagOption {
  key: string
  name: string
  type: FlagType
}

const ALL = '__all__'

/** Searchable flag selector with an "All flags" option. `value` is a flag key or undefined for all. */
export function FlagPicker({
  flags,
  value,
  onChange,
  id,
}: {
  flags: FlagOption[]
  value: string | undefined
  onChange: (flagKey: string | undefined) => void
  id?: string
}) {
  const { t } = useTranslation(['playground', 'common'])
  const [open, setOpen] = useState(false)
  const selected = value ? flags.find((f) => f.key === value) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <span className="truncate font-mono text-xs">{selected.key}</span>
            ) : value ? (
              <span className="truncate font-mono text-xs">{value}</span>
            ) : (
              <>
                <ListIcon className="text-muted-foreground" /> {t('picker.allFlags')}
              </>
            )}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command>
          <CommandInput placeholder={t('picker.searchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('picker.empty')}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={ALL}
                keywords={[t('picker.allKeywords')]}
                onSelect={() => {
                  onChange(undefined)
                  setOpen(false)
                }}
              >
                <ListIcon /> {t('picker.allFlags')}
                <CheckIcon className={cn('ml-auto', value ? 'opacity-0' : 'opacity-100')} />
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={t('common:labels.flags')}>
              {flags.map((flag) => (
                <CommandItem
                  key={flag.key}
                  value={flag.key}
                  keywords={[flag.name]}
                  onSelect={() => {
                    onChange(flag.key)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{flag.key}</span>
                  <FlagTypeBadge type={flag.type} />
                  <CheckIcon
                    className={cn('shrink-0', value === flag.key ? 'opacity-100' : 'opacity-0')}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
