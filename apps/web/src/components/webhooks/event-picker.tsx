import { useId, useMemo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface EventTypeInfo {
  type: string
  description: string
}

interface EventGroup {
  name: string
  items: EventTypeInfo[]
}

const CATEGORY_LABELS: Record<string, string> = {
  flag: 'Flags',
  segment: 'Segments',
  environment: 'Environments',
  experiment: 'Experiments',
  schedule: 'Scheduled changes',
  member: 'Members',
  api_key: 'API keys',
  project: 'Project',
  webhook: 'Webhooks',
  other: 'Other',
}

function groupEvents(types: readonly EventTypeInfo[], selected: string[]): EventGroup[] {
  const known = new Set(types.map((t) => t.type))
  const all = [
    ...types.filter((t) => t.type !== '*'),
    // Events saved earlier that are not offered in the list stay visible and removable.
    ...selected
      .filter((e) => e !== '*' && !known.has(e))
      .map((e) => ({ type: e, description: 'Custom event type' })),
  ]
  const groups = new Map<string, EventTypeInfo[]>()
  for (const item of all) {
    const category = item.type.split('.')[0] ?? 'other'
    const key = category in CATEGORY_LABELS ? category : 'other'
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()].map(([key, items]) => ({
    name: CATEGORY_LABELS[key] ?? key,
    // `x.*` first, then the specific events.
    items: [...items].sort((a, b) => Number(b.type.endsWith('.*')) - Number(a.type.endsWith('.*'))),
  }))
}

export interface EventPickerProps {
  value: string[]
  onChange: (value: string[]) => void
  eventTypes: readonly EventTypeInfo[]
  disabled?: boolean
  invalid?: boolean
}

/** "All events" switch plus grouped checkboxes with descriptions. */
export function EventPicker({ value, onChange, eventTypes, disabled, invalid }: EventPickerProps) {
  const baseId = useId()
  const all = value.includes('*')
  const groups = useMemo(() => groupEvents(eventTypes, value), [eventTypes, value])

  function toggle(type: string, checked: boolean) {
    onChange(checked ? [...value, type] : value.filter((e) => e !== type))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <Label htmlFor={`${baseId}-all`} className="flex flex-col items-start gap-0.5">
          <span>
            All events <span className="font-mono text-xs">(*)</span>
          </span>
          <span className="font-normal text-muted-foreground text-xs">
            Every audit log entry, including event types added in the future.
          </span>
        </Label>
        <Switch
          id={`${baseId}-all`}
          checked={all}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked ? ['*'] : [])}
        />
      </div>
      <ScrollArea
        className={cn(
          'h-64 rounded-lg border',
          all && 'opacity-50',
          invalid && !all && 'border-destructive',
        )}
        aria-disabled={all || undefined}
      >
        <div className="flex flex-col gap-4 p-3">
          {groups.map((group) => (
            <fieldset
              key={group.name}
              className="flex min-w-0 flex-col gap-2"
              disabled={all || disabled}
            >
              <legend className="mb-1 font-medium text-muted-foreground text-xs">
                {group.name}
              </legend>
              {group.items.map((item, index) => {
                const id = `${baseId}-${group.name}-${index}`
                return (
                  <div key={item.type} className="flex items-start gap-2.5">
                    <Checkbox
                      id={id}
                      checked={all || value.includes(item.type)}
                      onCheckedChange={(checked) => toggle(item.type, checked === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={id} className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="font-mono text-xs">{item.type}</span>
                      <span className="font-normal text-muted-foreground text-xs">
                        {item.description}
                      </span>
                    </Label>
                  </div>
                )
              })}
            </fieldset>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
