import { CalendarIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { roundedFromNow } from './utils'

const pad = (n: number) => String(n).padStart(2, '0')

function timeValue(date: Date | null): string {
  return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : ''
}

function withDay(base: Date | null, day: Date): Date {
  const next = new Date(day)
  const source = base ?? roundedFromNow(0)
  next.setHours(source.getHours(), source.getMinutes(), 0, 0)
  return next
}

export interface DateTimePickerProps {
  value: Date | null
  onChange: (value: Date) => void
  id?: string
  disabled?: boolean
  invalid?: boolean
  /** Days before this day cannot be picked. Defaults to today. */
  minDay?: Date
  className?: string
  'aria-label'?: string
}

/** Calendar popover plus a time input. Works in the viewer's local time zone. */
export function DateTimePicker({
  value,
  onChange,
  id,
  disabled,
  invalid,
  minDay,
  className,
  'aria-label': ariaLabel,
}: DateTimePickerProps) {
  const { t, i18n } = useTranslation(['schedules', 'common'])
  const [open, setOpen] = useState(false)
  const generated = useId()
  const baseId = id ?? generated
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const min = minDay ?? today

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={baseId}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-label={
              ariaLabel ? t('picker.dateAriaLabel', { label: ariaLabel }) : t('common:labels.date')
            }
            className={cn(
              'min-w-40 flex-1 justify-start font-normal tabular-nums',
              !value && 'text-muted-foreground',
            )}
          >
            <CalendarIcon />
            {value
              ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(value)
              : t('picker.pickDate')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ?? undefined}
            defaultMonth={value ?? undefined}
            onSelect={(day) => {
              if (!day) return
              onChange(withDay(value, day))
              setOpen(false)
            }}
            disabled={{ before: min }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={timeValue(value)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-label={
          ariaLabel ? t('picker.timeAriaLabel', { label: ariaLabel }) : t('common:labels.time')
        }
        className="w-32 tabular-nums"
        onChange={(event) => {
          const [hours, minutes] = event.target.value.split(':').map(Number)
          if (hours === undefined || minutes === undefined || Number.isNaN(hours)) return
          const next = new Date(value ?? roundedFromNow(0))
          next.setHours(hours, minutes, 0, 0)
          onChange(next)
        }}
      />
    </div>
  )
}
