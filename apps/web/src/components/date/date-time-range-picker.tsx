import { CalendarIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import { TimeSelect } from '@/components/date/time-select'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCalendarLocale } from '@/lib/calendar-locale'
import {
  combineDayAndTime,
  fromLocalInput,
  parseTimeValue,
  toLocalInput,
  toTimeValue,
} from '@/lib/datetime'
import { cn } from '@/lib/utils'

export interface DateTimeRangePickerProps {
  /** Local `YYYY-MM-DDTHH:mm` strings, as kept in URL search params. */
  from?: string
  to?: string
  onChange: (range: { from?: string; to?: string }) => void
  id?: string
  invalid?: boolean
  /** Minutes between time options. */
  step?: number
  className?: string
}

const START_OF_DAY = { hours: 0, minutes: 0 }
const END_OF_DAY = { hours: 23, minutes: 59 }

function timeOf(date: Date) {
  return { hours: date.getHours(), minutes: date.getMinutes() }
}

/**
 * A start and end instant chosen from one shadcn Calendar in range mode plus
 * two time selects. Either end may stay open.
 */
export function DateTimeRangePicker({
  from,
  to,
  onChange,
  id,
  invalid,
  step = 15,
  className,
}: DateTimeRangePickerProps) {
  const { t, i18n } = useTranslation()
  const locale = useCalendarLocale()
  const [open, setOpen] = useState(false)
  const fromDate = fromLocalInput(from)
  const toDate = fromLocalInput(to)
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  const label =
    fromDate || toDate
      ? `${fromDate ? format.format(fromDate) : '…'} – ${toDate ? format.format(toDate) : '…'}`
      : t('dateRange.anyTime')

  function selectDays(range: DateRange | undefined) {
    const nextFrom = range?.from
      ? combineDayAndTime(range.from, fromDate ? timeOf(fromDate) : START_OF_DAY)
      : undefined
    const nextTo = range?.to
      ? combineDayAndTime(range.to, toDate ? timeOf(toDate) : END_OF_DAY)
      : undefined
    onChange({
      from: nextFrom ? toLocalInput(nextFrom) : undefined,
      to: nextTo ? toLocalInput(nextTo) : undefined,
    })
  }

  function selectTime(which: 'from' | 'to', value: string) {
    const time = parseTimeValue(value)
    if (!time) return
    const base =
      which === 'from' ? (fromDate ?? toDate ?? new Date()) : (toDate ?? fromDate ?? new Date())
    const next = toLocalInput(combineDayAndTime(base, time))
    onChange(which === 'from' ? { from: next, to } : { from, to: next })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid || undefined}
          className={cn(
            'w-full justify-start font-normal tabular-nums',
            !fromDate && !toDate && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          locale={locale}
          numberOfMonths={2}
          selected={{ from: fromDate ?? undefined, to: toDate ?? undefined }}
          defaultMonth={fromDate ?? toDate ?? undefined}
          onSelect={selectDays}
          autoFocus
        />
        <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label
              htmlFor={id ? `${id}-start` : undefined}
              className="text-muted-foreground text-xs"
            >
              {t('dateRange.start')}
            </Label>
            <TimeSelect
              id={id ? `${id}-start` : undefined}
              value={toTimeValue(fromDate)}
              onChange={(v) => selectTime('from', v)}
              step={step}
              placeholder={t('dateRange.anyTime')}
              aria-label={t('dateRange.startTime')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={id ? `${id}-end` : undefined} className="text-muted-foreground text-xs">
              {t('dateRange.end')}
            </Label>
            <TimeSelect
              id={id ? `${id}-end` : undefined}
              value={toTimeValue(toDate)}
              onChange={(v) => selectTime('to', v)}
              step={step}
              placeholder={t('dateRange.anyTime')}
              aria-label={t('dateRange.endTime')}
            />
          </div>
          {fromDate || toDate ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sm:col-span-2 sm:justify-self-end"
              onClick={() => {
                onChange({ from: undefined, to: undefined })
                setOpen(false)
              }}
            >
              <XIcon /> {t('dateRange.clear')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
