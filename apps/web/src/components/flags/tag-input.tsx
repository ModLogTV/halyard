import { XIcon } from 'lucide-react'
import { type ClipboardEvent, type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface TagInputProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  'aria-label'?: string
  className?: string
}

const SEPARATOR = /[,\n\r]+/

/**
 * Multi-value input. Type a value and press Enter or comma to add it; paste a
 * comma-separated list to add several; Backspace on an empty field removes the last chip.
 */
export function TagInput({
  values,
  onChange,
  placeholder,
  disabled,
  invalid,
  className,
  'aria-label': ariaLabel,
}: TagInputProps) {
  const { t } = useTranslation('flags')
  const [text, setText] = useState('')

  function add(candidates: string[]) {
    const next = [...values]
    for (const candidate of candidates) {
      const trimmed = candidate.trim()
      if (trimmed && !next.includes(trimmed)) next.push(trimmed)
    }
    if (next.length !== values.length) onChange(next)
  }

  function commit() {
    if (text.trim()) add([text])
    setText('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // Never submit a surrounding form from here.
      event.preventDefault()
      commit()
    } else if (event.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text')
    if (!SEPARATOR.test(pasted)) return
    event.preventDefault()
    add(`${text}${pasted}`.split(SEPARATOR))
    setText('')
  }

  return (
    <div
      className={cn(
        'flex min-h-8 min-w-0 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30',
        invalid && 'border-destructive',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {values.map((value) => (
        <Badge
          key={value}
          variant="secondary"
          className="gap-0.5 rounded-md py-0 pr-0.5 pl-1.5 font-mono"
        >
          <span className="max-w-48 truncate">{value}</span>
          <button
            type="button"
            aria-label={t('tagInput.remove', { value })}
            disabled={disabled}
            className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            <XIcon className="size-3" aria-hidden="true" />
          </button>
        </Badge>
      ))}
      <input
        value={text}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        placeholder={values.length === 0 ? (placeholder ?? t('tagInput.placeholder')) : undefined}
        spellCheck={false}
        autoComplete="off"
        className="h-5 min-w-24 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:text-muted-foreground"
        onChange={(event) => {
          const raw = event.target.value
          if (raw.includes(',')) {
            const parts = raw.split(',')
            add(parts.slice(0, -1))
            setText(parts[parts.length - 1] ?? '')
          } else {
            setText(raw)
          }
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={commit}
      />
    </div>
  )
}
