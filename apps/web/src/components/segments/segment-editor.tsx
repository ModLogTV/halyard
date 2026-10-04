import type { AttributeCondition } from '@modlogtv/halyard-engine'
import { PlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConditionRow } from '@/components/flags/condition-row'
import { useStableKeys } from '@/components/flags/use-stable-keys'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export interface SegmentDraft {
  key: string
  name: string
  description: string
  match: 'all' | 'any'
  conditions: AttributeCondition[]
}

export const EMPTY_SEGMENT_DRAFT: SegmentDraft = {
  key: '',
  name: '',
  description: '',
  match: 'all',
  conditions: [],
}

export interface SegmentEditorProps {
  value: SegmentDraft
  onChange: (value: SegmentDraft) => void
  /** Create mode lets you type the key; edit mode shows it read-only. */
  mode: 'create' | 'edit'
  disabled?: boolean
  /** Problems from `validateSegment` for the key and the conditions. */
  keyProblem?: string
  problems?: string[]
  /** Suggested attribute names offered in the condition rows. */
  attributeSuggestions?: string[]
  /** Called when the name is typed in create mode so the parent can derive the key. */
  onNameChange?: (name: string) => void
  onKeyChange?: (key: string) => void
}

const newCondition = (): AttributeCondition => ({
  type: 'attribute',
  attribute: '',
  operator: 'eq',
})

/** Controlled form for a segment: key, name, description, match mode and attribute conditions. */
export function SegmentEditor({
  value,
  onChange,
  mode,
  disabled,
  keyProblem,
  problems = [],
  attributeSuggestions,
  onNameChange,
  onKeyChange,
}: SegmentEditorProps) {
  const { t } = useTranslation(['segments', 'common'])
  const stable = useStableKeys(value.conditions.length)
  const patch = (next: Partial<SegmentDraft>) => onChange({ ...value, ...next })

  return (
    <FieldGroup>
      <Field data-invalid={keyProblem ? true : undefined}>
        <FieldLabel htmlFor="segment-key">{t('common:labels.key')}</FieldLabel>
        <Input
          id="segment-key"
          value={value.key}
          onChange={(event) => {
            if (onKeyChange) onKeyChange(event.target.value)
            else patch({ key: event.target.value })
          }}
          readOnly={mode === 'edit'}
          disabled={disabled && mode === 'create'}
          placeholder={t('editor.key.placeholder')}
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={keyProblem ? true : undefined}
          autoFocus={mode === 'create'}
        />
        {keyProblem ? (
          <FieldError>{keyProblem}</FieldError>
        ) : (
          <FieldDescription>
            {mode === 'edit' ? t('editor.key.hintEdit') : t('editor.key.hintCreate')}
          </FieldDescription>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="segment-name">{t('common:labels.name')}</FieldLabel>
        <Input
          id="segment-name"
          value={value.name}
          onChange={(event) => {
            if (onNameChange) onNameChange(event.target.value)
            else patch({ name: event.target.value })
          }}
          placeholder={t('editor.name.placeholder')}
          disabled={disabled}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="segment-description">{t('common:labels.description')}</FieldLabel>
        <Textarea
          id="segment-description"
          value={value.description}
          onChange={(event) => patch({ description: event.target.value })}
          rows={2}
          placeholder={t('editor.description.placeholder')}
          disabled={disabled}
        />
      </Field>

      <FieldSet>
        <FieldLegend variant="label">{t('editor.membership.legend')}</FieldLegend>
        <FieldDescription>{t('editor.membership.description')}</FieldDescription>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={value.match}
          disabled={disabled}
          aria-label={t('editor.membership.matchMode')}
          onValueChange={(next) => {
            if (next === 'all' || next === 'any') patch({ match: next })
          }}
          className="w-fit"
        >
          <ToggleGroupItem value="all" className="px-3 text-xs">
            {t('editor.membership.all')}
          </ToggleGroupItem>
          <ToggleGroupItem value="any" className="px-3 text-xs">
            {t('editor.membership.any')}
          </ToggleGroupItem>
        </ToggleGroup>

        {value.conditions.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
            {t('editor.conditions.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {value.conditions.map((condition, index) => (
              <li key={stable.keys[index]} className="flex flex-col gap-1.5">
                {index > 0 ? (
                  <span className="pl-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {value.match === 'all' ? t('editor.conditions.and') : t('editor.conditions.or')}
                  </span>
                ) : null}
                <div className="rounded-md border bg-card p-2">
                  <ConditionRow
                    index={index}
                    condition={condition}
                    // Segments cannot reference segments. An empty option list disables
                    // the "switch to segment condition" menu entry in ConditionRow.
                    segments={[]}
                    attributeSuggestions={attributeSuggestions}
                    disabled={disabled}
                    onChange={(next) => {
                      if (next.type !== 'attribute') return
                      patch({
                        conditions: value.conditions.map((c, i) => (i === index ? next : c)),
                      })
                    }}
                    onRemove={() => {
                      stable.remove(index)
                      patch({ conditions: value.conditions.filter((_, i) => i !== index) })
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              stable.add()
              patch({ conditions: [...value.conditions, newCondition()] })
            }}
          >
            <PlusIcon /> {t('editor.conditions.add')}
          </Button>
        </div>

        {problems.length > 0 ? (
          <ul className="flex flex-col gap-1 text-destructive text-sm" aria-live="polite">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
      </FieldSet>
    </FieldGroup>
  )
}
