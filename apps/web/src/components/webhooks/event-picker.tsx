import type { TFunction } from 'i18next'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface EventTypeInfo {
  type: string
  description: string
}

type SettingsT = TFunction<['settings', 'common']>

interface EventGroup {
  name: string
  items: EventTypeInfo[]
}

const CATEGORY_KEYS = {
  flag: 'webhooks.picker.categories.flag',
  segment: 'webhooks.picker.categories.segment',
  environment: 'webhooks.picker.categories.environment',
  experiment: 'webhooks.picker.categories.experiment',
  schedule: 'webhooks.picker.categories.schedule',
  member: 'webhooks.picker.categories.member',
  api_key: 'webhooks.picker.categories.apiKey',
  project: 'webhooks.picker.categories.project',
  webhook: 'webhooks.picker.categories.webhook',
  other: 'webhooks.picker.categories.other',
} as const

const DESCRIPTION_KEYS = {
  '*': 'webhooks.eventDescriptions.all',
  'flag.*': 'webhooks.eventDescriptions.flagAll',
  'flag.created': 'webhooks.eventDescriptions.flagCreated',
  'flag.updated': 'webhooks.eventDescriptions.flagUpdated',
  'flag.toggled': 'webhooks.eventDescriptions.flagToggled',
  'flag.environment_updated': 'webhooks.eventDescriptions.flagEnvironmentUpdated',
  'flag.promoted': 'webhooks.eventDescriptions.flagPromoted',
  'flag.archived': 'webhooks.eventDescriptions.flagArchived',
  'flag.unarchived': 'webhooks.eventDescriptions.flagUnarchived',
  'flag.deleted': 'webhooks.eventDescriptions.flagDeleted',
  'segment.*': 'webhooks.eventDescriptions.segmentAll',
  'environment.*': 'webhooks.eventDescriptions.environmentAll',
  'experiment.*': 'webhooks.eventDescriptions.experimentAll',
  'schedule.*': 'webhooks.eventDescriptions.scheduleAll',
  'schedule.created': 'webhooks.eventDescriptions.scheduleCreated',
  'schedule.staged_rollout_created': 'webhooks.eventDescriptions.scheduleStagedRolloutCreated',
  'schedule.updated': 'webhooks.eventDescriptions.scheduleUpdated',
  'schedule.cancelled': 'webhooks.eventDescriptions.scheduleCancelled',
  'schedule.plan_cancelled': 'webhooks.eventDescriptions.schedulePlanCancelled',
  'schedule.executed': 'webhooks.eventDescriptions.scheduleExecuted',
  'schedule.failed': 'webhooks.eventDescriptions.scheduleFailed',
  'member.*': 'webhooks.eventDescriptions.memberAll',
  'api_key.*': 'webhooks.eventDescriptions.apiKeyAll',
  'project.*': 'webhooks.eventDescriptions.projectAll',
  'webhook.*': 'webhooks.eventDescriptions.webhookAll',
} as const

/** Translated description of an event type; unknown types fall back to the text the server sent. */
function describeEvent(t: SettingsT, item: EventTypeInfo): string {
  if (item.description === CUSTOM_EVENT) return t('webhooks.picker.customEvent')
  return item.type in DESCRIPTION_KEYS
    ? t(DESCRIPTION_KEYS[item.type as keyof typeof DESCRIPTION_KEYS])
    : item.description
}

/** Marker for events saved earlier that the server no longer offers. */
const CUSTOM_EVENT = 'custom'

function groupEvents(
  types: readonly EventTypeInfo[],
  selected: string[],
  t: SettingsT,
): EventGroup[] {
  const known = new Set(types.map((t) => t.type))
  const all = [
    ...types.filter((t) => t.type !== '*'),
    // Events saved earlier that are not offered in the list stay visible and removable.
    ...selected
      .filter((e) => e !== '*' && !known.has(e))
      .map((e) => ({ type: e, description: CUSTOM_EVENT })),
  ]
  const groups = new Map<keyof typeof CATEGORY_KEYS, EventTypeInfo[]>()
  for (const item of all) {
    const category = item.type.split('.')[0] ?? 'other'
    const key = category in CATEGORY_KEYS ? (category as keyof typeof CATEGORY_KEYS) : 'other'
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()].map(([key, items]) => ({
    name: t(CATEGORY_KEYS[key]),
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
  const { t } = useTranslation(['settings', 'common'])
  const baseId = useId()
  const all = value.includes('*')
  const groups = useMemo(() => groupEvents(eventTypes, value, t), [eventTypes, value, t])

  function toggle(type: string, checked: boolean) {
    onChange(checked ? [...value, type] : value.filter((e) => e !== type))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <Label htmlFor={`${baseId}-all`} className="flex flex-col items-start gap-0.5">
          <span>
            {t('webhooks.picker.allEvents')} <span className="font-mono text-xs">(*)</span>
          </span>
          <span className="font-normal text-muted-foreground text-xs">
            {t('webhooks.picker.allEventsHint')}
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
                        {describeEvent(t, item)}
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
