import type { FlagType, JsonValue, Variant } from '@halyard/engine'
import { isValidKey, validateFlagDefinition } from '@halyard/engine'
import { CircleAlertIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'
import { useStableKeys } from './use-stable-keys'
import { variantColor } from './variant-value'

export interface VariantsEditorProps {
  type: FlagType
  value: Variant[]
  onChange: (value: Variant[]) => void
  disabled?: boolean
  /** A flag needs at least this many variants. Defaults to 2. */
  minVariants?: number
  /** Variant keys referenced by live configuration. They cannot be renamed or removed. */
  lockedKeys?: string[]
  /**
   * Reports whether the variants are currently valid, including JSON that is mid-edit and
   * cannot be parsed (the last valid value stays in `value` until it parses again).
   */
  onValidityChange?: (valid: boolean) => void
  className?: string
}

const DEFAULT_VALUES: Record<FlagType, JsonValue> = {
  boolean: true,
  string: '',
  number: 0,
  json: {},
}

const COLUMNS = 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-start'

const ITEM_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const

function nextKey(variants: Variant[]): string {
  const taken = new Set(variants.map((v) => v.key))
  for (let n = variants.length + 1; ; n++) {
    if (!taken.has(`variant-${n}`)) return `variant-${n}`
  }
}

/** Boolean flags always have exactly one `true` and one `false` variant. */
function normaliseBoolean(variants: Variant[]): Variant[] | null {
  const on = variants.find((v) => v.value === true)
  const off = variants.find((v) => v.value === false)
  const ok = variants.length === 2 && on && off
  if (ok) return null
  return [on ?? { key: 'on', value: true }, off ?? { key: 'off', value: false }]
}

export function VariantsEditor({
  type,
  value,
  onChange,
  disabled,
  minVariants = 2,
  lockedKeys = [],
  onValidityChange,
  className,
}: VariantsEditorProps) {
  const { t } = useTranslation(['flags', 'common'])
  const isBoolean = type === 'boolean'
  const { keys, add, remove } = useStableKeys(value.length)
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({})

  // Keep boolean flags at exactly true/false.
  useEffect(() => {
    if (!isBoolean) return
    const fixed = normaliseBoolean(value)
    if (fixed) onChange(fixed)
  }, [isBoolean, value, onChange])

  const problems = useMemo(
    () =>
      validateFlagDefinition({ key: 'flag', type, variants: value }).filter(
        (problem) => !problem.startsWith('Flag key'),
      ),
    [type, value],
  )
  const hasJsonError = keys.some((key) => jsonErrors[key])
  const valid = problems.length === 0 && !hasJsonError

  const lastValid = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (lastValid.current !== valid) {
      lastValid.current = valid
      onValidityChange?.(valid)
    }
  }, [valid, onValidityChange])

  const setJsonError = useCallback((rowKey: string, message: string | null) => {
    setJsonErrors((current) => {
      if ((current[rowKey] ?? null) === message) return current
      const next = { ...current }
      if (message) next[rowKey] = message
      else delete next[rowKey]
      return next
    })
  }, [])

  const keyCounts = new Map<string, number>()
  for (const variant of value) keyCounts.set(variant.key, (keyCounts.get(variant.key) ?? 0) + 1)

  const patch = (index: number, change: Partial<Variant>) => {
    onChange(value.map((variant, i) => (i === index ? { ...variant, ...change } : variant)))
  }

  function addVariant() {
    add()
    onChange([...value, { key: nextKey(value), value: DEFAULT_VALUES[type] }])
  }

  function removeVariant(index: number) {
    remove(index)
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn('flex flex-col gap-3', className)}>
        <div
          className={cn(
            'hidden gap-2 px-0.5 font-medium text-muted-foreground text-xs md:grid',
            COLUMNS,
          )}
          aria-hidden="true"
        >
          <span>{t('common:labels.key')}</span>
          <span>{t('common:labels.value')}</span>
          <span>{t('variants.nameColumn')}</span>
          <span className="w-8" />
        </div>

        <ul className="relative flex flex-col gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {value.map((variant, index) => {
              const rowKey = keys[index] ?? String(index)
              const locked = lockedKeys.includes(variant.key)
              const keyInvalid = !isValidKey(variant.key) || (keyCounts.get(variant.key) ?? 0) > 1
              const n = index + 1
              const removeReason = isBoolean
                ? undefined
                : locked
                  ? t('variants.removeReasonLocked')
                  : value.length <= minVariants
                    ? t('variants.removeReasonMinimum', { count: minVariants })
                    : undefined
              return (
                <motion.li
                  key={rowKey}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={ITEM_TRANSITION}
                  className={cn('grid grid-cols-1 gap-2', COLUMNS)}
                >
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="-translate-y-1/2 absolute top-4 left-2.5 size-2 rounded-full"
                      style={{ backgroundColor: variantColor(index) }}
                    />
                    <Input
                      value={variant.key}
                      onChange={(event) => patch(index, { key: event.target.value })}
                      placeholder="variant-key"
                      aria-label={t('variants.keyLabel', { n })}
                      aria-invalid={keyInvalid || undefined}
                      readOnly={locked}
                      disabled={disabled}
                      spellCheck={false}
                      autoComplete="off"
                      className="h-8 pl-6 font-mono text-xs md:text-xs"
                    />
                  </div>

                  <ValueField
                    type={type}
                    rowKey={rowKey}
                    value={variant.value}
                    n={n}
                    disabled={disabled}
                    onChange={(next) => patch(index, { value: next })}
                    onJsonError={setJsonError}
                  />

                  <Input
                    value={variant.name ?? ''}
                    onChange={(event) => {
                      const { name: _omit, ...rest } = variant
                      onChange(
                        value.map((v, i) =>
                          i === index
                            ? event.target.value
                              ? { ...rest, name: event.target.value }
                              : rest
                            : v,
                        ),
                      )
                    }}
                    placeholder={t('variants.namePlaceholder')}
                    aria-label={t('variants.nameLabel', { n })}
                    disabled={disabled}
                    className="h-8 text-xs md:text-xs"
                  />

                  <div className="flex h-8 w-8 items-center justify-end">
                    {isBoolean ? null : (
                      <IconButton
                        label={t('variants.removeLabel', { name: variant.key || n })}
                        tooltip={t('variants.remove')}
                        disabledReason={removeReason}
                        disabled={disabled}
                        className="hover:text-destructive"
                        onClick={() => removeVariant(index)}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </IconButton>
                    )}
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>

        {isBoolean ? (
          <p className="text-muted-foreground text-xs">
            <Trans
              t={t}
              i18nKey="variants.booleanHint"
              components={[
                <span key="true" className="font-mono" />,
                <span key="false" className="font-mono" />,
              ]}
            />
          </p>
        ) : (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addVariant}
              disabled={disabled}
            >
              <PlusIcon aria-hidden="true" />
              {t('variants.add')}
            </Button>
          </div>
        )}

        {problems.length > 0 ? (
          <Alert variant="destructive" className="py-2">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription>
              <p className="font-medium">
                {t('variants.problemsTitle', { count: problems.length })}
              </p>
              <ul className="list-inside list-disc">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </MotionConfig>
  )
}

function ValueField({
  type,
  rowKey,
  value,
  n,
  disabled,
  onChange,
  onJsonError,
}: {
  type: FlagType
  rowKey: string
  value: JsonValue
  n: number
  disabled?: boolean
  onChange: (value: JsonValue) => void
  onJsonError: (rowKey: string, message: string | null) => void
}) {
  const { t } = useTranslation('flags')
  const label = t('variants.valueLabel', { n })
  if (type === 'boolean') {
    return (
      <div className="flex h-8 items-center">
        <Badge
          variant="outline"
          className="font-mono text-xs"
          aria-label={t('variants.booleanValueLabel', { label, value: String(value) })}
        >
          {String(value)}
        </Badge>
      </div>
    )
  }
  if (type === 'number') {
    return <NumberField label={label} value={value} disabled={disabled} onChange={onChange} />
  }
  if (type === 'json') {
    return (
      <JsonField
        label={label}
        rowKey={rowKey}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onError={onJsonError}
      />
    )
  }
  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={t('variants.valuePlaceholder')}
      aria-label={label}
      disabled={disabled}
      spellCheck={false}
      className="h-8 font-mono text-xs md:text-xs"
    />
  )
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: JsonValue
  disabled?: boolean
  onChange: (value: JsonValue) => void
}) {
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '')
  useEffect(() => {
    setText((current) =>
      typeof value === 'number' && Number(current) !== value ? String(value) : current,
    )
  }, [value])
  return (
    <Input
      type="number"
      step="any"
      value={text}
      onChange={(event) => {
        const raw = event.target.value
        setText(raw)
        const parsed = Number(raw)
        // Empty or unparsable input becomes null, which the validator reports.
        onChange(raw !== '' && Number.isFinite(parsed) ? parsed : null)
      }}
      placeholder="0"
      aria-label={label}
      aria-invalid={typeof value !== 'number' || undefined}
      disabled={disabled}
      className="tabular h-8 font-mono text-xs md:text-xs"
    />
  )
}

function pretty(value: JsonValue): string {
  return JSON.stringify(value, null, 2) ?? ''
}

function JsonField({
  label,
  rowKey,
  value,
  disabled,
  onChange,
  onError,
}: {
  label: string
  rowKey: string
  value: JsonValue
  disabled?: boolean
  onChange: (value: JsonValue) => void
  onError: (rowKey: string, message: string | null) => void
}) {
  const { t } = useTranslation('flags')
  const [text, setText] = useState(() => pretty(value))
  const [error, setError] = useState<string | null>(null)
  const lastEmitted = useRef(JSON.stringify(value))

  // Follow changes that did not come from typing here (for example a form reset).
  useEffect(() => {
    const serialised = JSON.stringify(value)
    if (serialised !== lastEmitted.current) {
      lastEmitted.current = serialised
      setText(pretty(value))
      setError(null)
      onError(rowKey, null)
    }
  }, [value, rowKey, onError])

  // Clear this row's error when it goes away.
  useEffect(() => () => onError(rowKey, null), [rowKey, onError])

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Textarea
        value={text}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          try {
            const parsed = JSON.parse(raw) as JsonValue
            lastEmitted.current = JSON.stringify(parsed)
            setError(null)
            onError(rowKey, null)
            onChange(parsed)
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : t('variants.invalidJson')
            setError(message)
            onError(rowKey, message)
          }
        }}
        placeholder="{}"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        spellCheck={false}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        className="min-h-8 resize-y px-2 py-1.5 font-mono text-xs md:text-xs"
      />
      {error ? (
        <p className="break-words font-mono text-destructive text-[11px] leading-snug">{error}</p>
      ) : null}
    </div>
  )
}
