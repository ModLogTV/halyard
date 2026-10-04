import type {
  AttributeCondition,
  Condition,
  FlagDefinition,
  Rule,
  SegmentCondition,
} from '@modlogtv/halyard-engine'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
  VariableIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ConditionRow } from './condition-row'
import { IconButton } from './icon-button'
import { ServeEditor } from './serve-editor'
import type { SegmentOption } from './types'
import { useStableKeys } from './use-stable-keys'

export interface RuleCardProps {
  rule: Rule
  /** Zero-based position of the rule. */
  index: number
  total: number
  flag: FlagDefinition
  segments: SegmentOption[]
  attributeSuggestions?: string[]
  onChange: (rule: Rule) => void
  onRemove: () => void
  onMove: (direction: 'up' | 'down') => void
  disabled?: boolean
  /** Validation messages for this rule, shown under the card. */
  problems?: string[]
  className?: string
}

const ITEM_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const

export function RuleCard({
  rule,
  index,
  total,
  flag,
  segments,
  attributeSuggestions,
  onChange,
  onRemove,
  onMove,
  disabled,
  problems = [],
  className,
}: RuleCardProps) {
  const { t } = useTranslation(['flags', 'common'])
  const n = index + 1
  const { keys, add, remove } = useStableKeys(rule.conditions.length)

  const setConditions = (conditions: Condition[]) => onChange({ ...rule, conditions })

  function addCondition(kind: 'attribute' | 'segment') {
    const condition: AttributeCondition | SegmentCondition =
      kind === 'attribute'
        ? { type: 'attribute', attribute: '', operator: 'eq' }
        : { type: 'segment', segmentKey: '' }
    add()
    setConditions([...rule.conditions, condition])
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Card
        className="gap-0 overflow-hidden py-0 shadow-xs"
        role="group"
        aria-label={t('rule.label', { n })}
        data-invalid={problems.length > 0 || undefined}
      >
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
          <Badge variant="secondary" className="tabular shrink-0 rounded-md font-mono">
            {t('rule.badge', { n })}
          </Badge>
          <Input
            value={rule.description ?? ''}
            onChange={(event) => {
              const { description: _omit, ...rest } = rule
              onChange(event.target.value ? { ...rest, description: event.target.value } : rest)
            }}
            placeholder={t('rule.descriptionPlaceholder')}
            aria-label={t('rule.descriptionLabel', { n })}
            disabled={disabled}
            className="h-8 min-w-0 flex-1 border-transparent bg-transparent text-sm shadow-none hover:border-input focus-visible:bg-background dark:bg-transparent"
          />
          <div className="flex shrink-0 items-center">
            <IconButton
              label={t('rule.moveUpLabel', { n })}
              tooltip={t('rule.moveUp')}
              disabled={disabled || index === 0}
              onClick={() => onMove('up')}
            >
              <ArrowUpIcon aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t('rule.moveDownLabel', { n })}
              tooltip={t('rule.moveDown')}
              disabled={disabled || index >= total - 1}
              onClick={() => onMove('down')}
            >
              <ArrowDownIcon aria-hidden="true" />
            </IconButton>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <IconButton
                  label={t('rule.removeLabel', { n })}
                  tooltip={t('rule.remove')}
                  disabled={disabled}
                  className="hover:text-destructive"
                >
                  <Trash2Icon aria-hidden="true" />
                </IconButton>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('rule.removeConfirmTitle', { n })}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('rule.removeConfirmDescription')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onRemove}>
                    {t('rule.remove')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-3 py-3">
          {rule.conditions.length === 0 ? (
            <div className="flex items-center gap-3">
              <ConditionLabel>{t('rule.if')}</ConditionLabel>
              <p className="text-muted-foreground text-sm">{t('rule.noConditions')}</p>
            </div>
          ) : (
            <ul className="relative flex flex-col gap-2">
              <AnimatePresence initial={false} mode="popLayout">
                {rule.conditions.map((condition, conditionIndex) => (
                  <motion.li
                    key={keys[conditionIndex]}
                    layout="position"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={ITEM_TRANSITION}
                    className="flex items-start gap-3"
                  >
                    <ConditionLabel>
                      {conditionIndex === 0 ? t('rule.if') : t('rule.and')}
                    </ConditionLabel>
                    <div className="min-w-0 flex-1">
                      <ConditionRow
                        condition={condition}
                        index={conditionIndex}
                        segments={segments}
                        attributeSuggestions={attributeSuggestions}
                        disabled={disabled}
                        onChange={(next) =>
                          setConditions(
                            rule.conditions.map((c, i) => (i === conditionIndex ? next : c)),
                          )
                        }
                        onRemove={() => {
                          remove(conditionIndex)
                          setConditions(rule.conditions.filter((_, i) => i !== conditionIndex))
                        }}
                      />
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}

          <div className="pl-[calc(2.5rem+0.75rem)]">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  className="-ml-2 text-muted-foreground"
                >
                  <PlusIcon aria-hidden="true" />
                  {t('rule.addCondition')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => addCondition('attribute')}>
                  <VariableIcon aria-hidden="true" />
                  {t('rule.attributeCondition')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={segments.length === 0}
                  onSelect={() => addCondition('segment')}
                >
                  <UsersIcon aria-hidden="true" />
                  {t('rule.segmentCondition')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-start gap-3 border-t bg-muted/20 px-3 py-3">
          <ConditionLabel className="pt-1.5">{t('rule.serve')}</ConditionLabel>
          <ServeEditor
            flag={flag}
            value={rule.serve}
            onChange={(serve) => onChange({ ...rule, serve })}
            disabled={disabled}
            className="flex-1"
          />
        </div>
      </Card>

      {problems.length > 0 ? (
        <ul className="flex flex-col gap-0.5 px-1">
          {problems.map((problem) => (
            <li key={problem} className="text-destructive text-xs">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ConditionLabel({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-10 shrink-0 items-center font-medium text-muted-foreground text-xs',
        className,
      )}
    >
      {children}
    </span>
  )
}
