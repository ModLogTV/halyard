import { ClockIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')

export interface TimeSelectProps {
  /** `HH:mm` or empty. */
  value: string
  onChange: (value: string) => void
  /** Minutes between options. Off-grid values are kept as an extra option. */
  step?: number
  id?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
}

/** A time of day as a shadcn Select, formatted in the UI language. */
export function TimeSelect({
  value,
  onChange,
  step = 15,
  id,
  disabled,
  invalid,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: TimeSelectProps) {
  const { i18n } = useTranslation()
  const options = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' })
    const values = new Set<string>()
    for (let minutes = 0; minutes < 24 * 60; minutes += step) {
      values.add(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`)
    }
    if (value) values.add(value)
    return [...values].sort().map((v) => {
      const [h, m] = v.split(':').map(Number)
      const date = new Date(2000, 0, 1, h, m)
      return { value: v, label: format.format(date) }
    })
  }, [i18n.language, step, value])
  const current = options.find((o) => o.value === value)

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn('tabular-nums', !value && 'text-muted-foreground', className)}
      >
        <ClockIcon />
        <SelectValue placeholder={placeholder}>{current?.label ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-64">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="tabular-nums">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
