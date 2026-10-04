import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/flags/icon-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  type AttributeRow,
  type AttributeType,
  type BuiltContext,
  type ContextDraft,
  type ContextErrorCode,
  draftToContext,
  newRow,
  parseContextJson,
} from './context'

const ATTRIBUTE_TYPES: AttributeType[] = ['string', 'number', 'boolean', 'json']

function defaultValueFor(type: AttributeType): string {
  if (type === 'boolean') return 'true'
  if (type === 'number') return '0'
  if (type === 'json') return '{}'
  return ''
}

function AttributeRowEditor({
  row,
  error,
  onChange,
  onRemove,
}: {
  row: AttributeRow
  error?: ContextErrorCode
  onChange: (row: AttributeRow) => void
  onRemove: () => void
}) {
  const { t } = useTranslation(['playground', 'common'])
  const errorId = useId()
  const label = row.key || t('editor.attributes.fallback')
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          value={row.key}
          onChange={(e) => onChange({ ...row, key: e.target.value })}
          placeholder={t('editor.attributes.namePlaceholder')}
          aria-label={t('editor.attributes.nameLabel')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-8 w-28 shrink-0 font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
        />
        <Select
          value={row.type}
          onValueChange={(type) => {
            const next = type as AttributeType
            onChange({ ...row, type: next, value: defaultValueFor(next) })
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-24 shrink-0 text-xs"
            aria-label={t('editor.attributes.typeOf', { name: label })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATTRIBUTE_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`common:flagTypes.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {row.type === 'boolean' ? (
          <Select value={row.value} onValueChange={(value) => onChange({ ...row, value })}>
            <SelectTrigger
              size="sm"
              className="min-w-0 flex-1 font-mono text-xs"
              aria-label={t('editor.attributes.valueOf', { name: label })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">true</SelectItem>
              <SelectItem value="false">false</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={row.value}
            onChange={(e) => onChange({ ...row, value: e.target.value })}
            placeholder={row.type === 'json' ? '{"a": 1}' : t('editor.attributes.valuePlaceholder')}
            aria-label={t('editor.attributes.valueOf', { name: label })}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            inputMode={row.type === 'number' ? 'decimal' : undefined}
            className="h-8 min-w-0 flex-1 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
          />
        )}
        <IconButton label={t('editor.attributes.remove', { name: label })} onClick={onRemove}>
          <Trash2Icon />
        </IconButton>
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {t(`editor.errors.${error}`)}
        </p>
      ) : null}
    </li>
  )
}

function JsonEditor({
  draft,
  onChange,
}: {
  draft: ContextDraft
  onChange: (draft: ContextDraft) => void
}) {
  const { t } = useTranslation('playground')
  const errorId = useId()
  const [text, setText] = useState(() => JSON.stringify(draftToContext(draft).context, null, 2))
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const parsed = parseContextJson(e.target.value)
          if ('error' in parsed) {
            setError(parsed.detail ?? t(`editor.json.errors.${parsed.error}`))
          } else {
            setError(null)
            onChange(parsed.draft)
          }
        }}
        aria-label={t('editor.json.ariaLabel')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        spellCheck={false}
        rows={12}
        className={cn('font-mono text-xs leading-relaxed', error && 'border-destructive')}
      />
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {t('editor.json.errorWithFallback', { error })}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('editor.json.hint')}</p>
      )}
    </div>
  )
}

export interface ContextEditorProps {
  draft: ContextDraft
  onChange: (draft: ContextDraft) => void
  /** Changes whenever the draft is replaced from outside (preset, shared link) so the JSON tab reloads. */
  resetKey: number
  built: BuiltContext
}

/** Targeting key, typed attribute rows and a two-way synced JSON tab. */
export function ContextEditor({ draft, onChange, resetKey, built }: ContextEditorProps) {
  const { t } = useTranslation('playground')
  const [tab, setTab] = useState('form')
  const keyId = useId()

  const updateRow = (row: AttributeRow) =>
    onChange({ ...draft, rows: draft.rows.map((r) => (r.id === row.id ? row : r)) })

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="w-full">
        <TabsTrigger value="form">{t('editor.tabs.form')}</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>
      <TabsContent value="form" className="flex flex-col gap-4 pt-1">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={keyId} className="text-sm font-medium">
            {t('editor.targetingKey.label')}
          </label>
          <Input
            id={keyId}
            value={draft.targetingKey}
            onChange={(e) => onChange({ ...draft, targetingKey: e.target.value })}
            placeholder="user-42"
            className="font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{t('editor.targetingKey.hint')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('editor.attributes.title')}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...draft, rows: [...draft.rows, newRow()] })}
            >
              <PlusIcon /> {t('editor.attributes.add')}
            </Button>
          </div>
          {draft.rows.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              {t('editor.attributes.empty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {draft.rows.map((row) => (
                <AttributeRowEditor
                  key={row.id}
                  row={row}
                  error={built.errors[row.id]}
                  onChange={updateRow}
                  onRemove={() =>
                    onChange({ ...draft, rows: draft.rows.filter((r) => r.id !== row.id) })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </TabsContent>
      <TabsContent value="json" className="pt-1">
        <JsonEditor key={resetKey} draft={draft} onChange={onChange} />
      </TabsContent>
    </Tabs>
  )
}
