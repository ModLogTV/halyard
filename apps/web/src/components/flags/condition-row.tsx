import type {
  AttributeCondition,
  Condition,
  JsonValue,
  Operator,
  SegmentCondition,
} from '@halyard/engine'
import { validateCondition } from '@halyard/engine'
import { MoreHorizontalIcon, Trash2Icon, UsersIcon, VariableIcon } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { coerceValue, OPERATOR_GROUPS, valueKind } from './operators'
import { TagInput } from './tag-input'
import type { SegmentOption } from './types'

export interface ConditionRowProps {
  condition: Condition
  onChange: (condition: Condition) => void
  onRemove: () => void
  segments: SegmentOption[]
  /** Attribute names offered while typing. `targetingKey` is always offered. */
  attributeSuggestions?: string[]
  disabled?: boolean
  /** Zero-based position in the rule; used for accessible names. */
  index: number
}

const FIELD = 'h-8 text-xs md:text-xs'
const MONO_FIELD = `${FIELD} font-mono`

export function ConditionRow({
  condition,
  onChange,
  onRemove,
  segments,
  attributeSuggestions = [],
  disabled,
  index,
}: ConditionRowProps) {
  const n = index + 1
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      {condition.type === 'attribute' ? (
        <AttributeFields
          condition={condition}
          onChange={onChange}
          suggestions={attributeSuggestions}
          disabled={disabled}
          n={n}
        />
      ) : (
        <SegmentFields
          condition={condition}
          onChange={onChange}
          segments={segments}
          disabled={disabled}
          n={n}
        />
      )}

      <TooltipProvider delayDuration={300}>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto text-muted-foreground"
                  aria-label={`Condition ${n} actions`}
                  disabled={disabled}
                >
                  <MoreHorizontalIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Condition actions</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {condition.type === 'attribute' ? (
              <DropdownMenuItem
                disabled={segments.length === 0}
                onSelect={() => onChange({ type: 'segment', segmentKey: '' })}
              >
                <UsersIcon aria-hidden="true" />
                Switch to segment condition
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => onChange({ type: 'attribute', attribute: '', operator: 'eq' })}
              >
                <VariableIcon aria-hidden="true" />
                Switch to attribute condition
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2Icon aria-hidden="true" />
              Remove condition
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    </div>
  )
}

function AttributeFields({
  condition,
  onChange,
  suggestions,
  disabled,
  n,
}: {
  condition: AttributeCondition
  onChange: (condition: Condition) => void
  suggestions: string[]
  disabled?: boolean
  n: number
}) {
  const listId = useId()
  const options = Array.from(new Set(['targetingKey', ...suggestions]))
  const kind = valueKind(condition.operator)
  const { value } = condition

  const patch = (next: Partial<AttributeCondition>) => {
    const merged: AttributeCondition = { ...condition, ...next }
    if (merged.value === undefined) delete merged.value
    onChange(merged)
  }

  const setOperator = (operator: Operator) =>
    patch({ operator, value: coerceValue(operator, value) })

  const scalarText =
    value === undefined || value === null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  // Only flag a typed value; a half-filled new row is not "wrong" yet.
  const valueInvalid =
    scalarText !== '' &&
    (kind === 'regex' || kind === 'version') &&
    validateCondition(condition).some((problem) => problem.startsWith('operator'))

  return (
    <>
      <div className="w-44 shrink-0">
        <Input
          value={condition.attribute}
          onChange={(event) => patch({ attribute: event.target.value })}
          list={listId}
          placeholder="Attribute"
          aria-label={`Condition ${n} attribute`}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          className={MONO_FIELD}
        />
        <datalist id={listId}>
          {options.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      <Select
        value={condition.operator}
        onValueChange={(next) => setOperator(next as Operator)}
        disabled={disabled}
      >
        <SelectTrigger
          size="sm"
          className="w-44 shrink-0 text-xs"
          aria-label={`Condition ${n} operator`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {OPERATOR_GROUPS.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.operators.map((operator) => (
                <SelectItem key={operator.value} value={operator.value}>
                  {operator.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {kind === 'none' ? (
        <span className="flex h-8 flex-1 items-center text-muted-foreground text-xs">
          No value needed
        </span>
      ) : kind === 'list' ? (
        <TagInput
          values={Array.isArray(value) ? value.map(stringify) : []}
          onChange={(values) => patch({ value: values })}
          disabled={disabled}
          aria-label={`Condition ${n} values`}
          className="min-w-48 flex-1"
        />
      ) : kind === 'number' ? (
        <Input
          type="number"
          step="any"
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(event) => {
            const raw = event.target.value
            patch({ value: raw === '' ? undefined : Number(raw) })
          }}
          placeholder="0"
          aria-label={`Condition ${n} value`}
          disabled={disabled}
          className={cn(MONO_FIELD, 'min-w-32 flex-1')}
        />
      ) : (
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <Input
            value={scalarText}
            onChange={(event) => {
              const raw = event.target.value
              patch({ value: raw === '' ? undefined : raw })
            }}
            placeholder={kind === 'version' ? '1.2.3' : kind === 'regex' ? '^beta-.*$' : 'Value'}
            aria-label={`Condition ${n} value`}
            aria-invalid={valueInvalid || undefined}
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            className={MONO_FIELD}
          />
          {kind === 'equality' && isBooleanLike(value) ? (
            <BooleanToggle
              value={value}
              onChange={(next) => patch({ value: next })}
              n={n}
              disabled={disabled}
            />
          ) : null}
        </div>
      )}
    </>
  )
}

function stringify(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isBooleanLike(value: JsonValue | undefined): boolean {
  if (typeof value === 'boolean') return true
  return typeof value === 'string' && ['true', 'false'].includes(value.trim().toLowerCase())
}

/**
 * Shown when the typed value reads as `true` / `false`. Selecting a side stores a real
 * boolean; deselecting it goes back to the plain string.
 */
function BooleanToggle({
  value,
  onChange,
  n,
  disabled,
}: {
  value: JsonValue | undefined
  onChange: (value: JsonValue) => void
  n: number
  disabled?: boolean
}) {
  const current = typeof value === 'boolean' ? String(value) : ''
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={current}
      disabled={disabled}
      aria-label={`Condition ${n}: match as boolean`}
      onValueChange={(next) => {
        if (next === 'true' || next === 'false') onChange(next === 'true')
        else onChange(String(value).trim().toLowerCase())
      }}
    >
      <ToggleGroupItem value="true" className="h-8 px-2 font-mono text-xs">
        true
      </ToggleGroupItem>
      <ToggleGroupItem value="false" className="h-8 px-2 font-mono text-xs">
        false
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

function SegmentFields({
  condition,
  onChange,
  segments,
  disabled,
  n,
}: {
  condition: SegmentCondition
  onChange: (condition: Condition) => void
  segments: SegmentOption[]
  disabled?: boolean
  n: number
}) {
  const known = segments.some((segment) => segment.key === condition.segmentKey)
  return (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={condition.negate ? 'not' : 'in'}
        disabled={disabled}
        aria-label={`Condition ${n} membership`}
        onValueChange={(next) => {
          if (!next) return
          const { negate: _omit, ...rest } = condition
          onChange(next === 'not' ? { ...rest, negate: true } : rest)
        }}
      >
        <ToggleGroupItem value="in" className="h-8 px-2.5 text-xs">
          is in
        </ToggleGroupItem>
        <ToggleGroupItem value="not" className="h-8 px-2.5 text-xs">
          is not in
        </ToggleGroupItem>
      </ToggleGroup>

      <Select
        value={condition.segmentKey || undefined}
        onValueChange={(segmentKey) => onChange({ ...condition, segmentKey })}
        disabled={disabled}
      >
        <SelectTrigger
          size="sm"
          className="min-w-48 flex-1 text-xs"
          aria-label={`Condition ${n} segment`}
        >
          <SelectValue placeholder="Select a segment" />
        </SelectTrigger>
        <SelectContent position="popper">
          {segments.map((segment) => (
            <SelectItem key={segment.key} value={segment.key}>
              <span className="font-mono text-xs">{segment.key}</span>
              {segment.name && segment.name !== segment.key ? (
                <span className="text-muted-foreground text-xs">{segment.name}</span>
              ) : null}
            </SelectItem>
          ))}
          {condition.segmentKey && !known ? (
            <SelectItem value={condition.segmentKey} disabled>
              <span className="font-mono text-destructive text-xs">
                {condition.segmentKey} (missing)
              </span>
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </>
  )
}
