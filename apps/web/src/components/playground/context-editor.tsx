import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useId, useState } from 'react'
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
  draftToContext,
  newRow,
  parseContextJson,
} from './context'

const TYPE_LABELS: Record<AttributeType, string> = {
  string: 'String',
  number: 'Number',
  boolean: 'Boolean',
  json: 'JSON',
}

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
  error?: string
  onChange: (row: AttributeRow) => void
  onRemove: () => void
}) {
  const errorId = useId()
  const label = row.key || 'attribute'
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          value={row.key}
          onChange={(e) => onChange({ ...row, key: e.target.value })}
          placeholder="name"
          aria-label="Attribute name"
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
            aria-label={`Type of ${label}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([value, text]) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {row.type === 'boolean' ? (
          <Select value={row.value} onValueChange={(value) => onChange({ ...row, value })}>
            <SelectTrigger
              size="sm"
              className="min-w-0 flex-1 font-mono text-xs"
              aria-label={`Value of ${label}`}
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
            placeholder={row.type === 'json' ? '{"a": 1}' : 'value'}
            aria-label={`Value of ${label}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            inputMode={row.type === 'number' ? 'decimal' : undefined}
            className="h-8 min-w-0 flex-1 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
          />
        )}
        <IconButton label={`Remove ${label}`} onClick={onRemove}>
          <Trash2Icon />
        </IconButton>
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
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
          if ('error' in parsed) setError(parsed.error)
          else {
            setError(null)
            onChange(parsed.draft)
          }
        }}
        aria-label="Evaluation context as JSON"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        spellCheck={false}
        rows={12}
        className={cn('font-mono text-xs leading-relaxed', error && 'border-destructive')}
      />
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}. Evaluation uses the last valid context.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Edits apply to the form tab too. Values must be JSON.
        </p>
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
  const [tab, setTab] = useState('form')
  const keyId = useId()

  const updateRow = (row: AttributeRow) =>
    onChange({ ...draft, rows: draft.rows.map((r) => (r.id === row.id ? row : r)) })

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="w-full">
        <TabsTrigger value="form">Form</TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>
      <TabsContent value="form" className="flex flex-col gap-4 pt-1">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={keyId} className="text-sm font-medium">
            Targeting key
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
          <p className="text-xs text-muted-foreground">
            Identifies the user. Percentage rollouts stay sticky per targeting key.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Attributes</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...draft, rows: [...draft.rows, newRow()] })}
            >
              <PlusIcon /> Add attribute
            </Button>
          </div>
          {draft.rows.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              No attributes. Add some such as country or plan to match targeting rules.
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
