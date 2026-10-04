import type { FlagDefinition, FlagEnvironmentConfig, Rule } from '@halyard/engine'
import { validateEnvironmentConfig } from '@halyard/engine'
import { CircleAlertIcon, PlusIcon } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { type ReactNode, useId, useMemo } from 'react'
import { EnvBadge, type EnvironmentLike, envStyle } from '@/components/env/env-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RuleCard } from './rule-card'
import { ServeEditor } from './serve-editor'
import { primaryVariant } from './serve-utils'
import type { SegmentOption } from './types'
import { newId } from './use-stable-keys'
import { VariantSelect } from './variant-value'

export interface TargetingProblems {
  /** Every problem as reported by the engine. */
  all: string[]
  /** Problems that could not be tied to a section; shown in the summary alert. */
  summary: string[]
  offVariant: string[]
  fallthrough: string[]
  /** Problems per rule, index-aligned with `config.rules`. */
  rules: string[][]
  isValid: boolean
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function sortProblems(config: FlagEnvironmentConfig, all: string[]): TargetingProblems {
  const rules: string[][] = (Array.isArray(config.rules) ? config.rules : []).map(() => [])
  const result: TargetingProblems = {
    all,
    summary: [],
    offVariant: [],
    fallthrough: [],
    rules,
    isValid: all.length === 0,
  }

  for (const problem of all) {
    const ruleMatch = /^Rule (\d+)(?: \("[^"]*"\))?(?::|,) (.*)$/s.exec(problem)
    if (ruleMatch) {
      const bucket = rules[Number(ruleMatch[1]) - 1]
      if (bucket) {
        bucket.push(capitalise(ruleMatch[2] ?? ''))
        continue
      }
    }
    const duplicate = /^Rule id "(.*)" is used more than once$/s.exec(problem)
    if (duplicate) {
      config.rules.forEach((rule, index) => {
        if (rule.id === duplicate[1]) rules[index]?.push('Another rule has the same id.')
      })
      continue
    }
    if (problem.startsWith('Fallthrough: ')) {
      result.fallthrough.push(capitalise(problem.slice('Fallthrough: '.length)))
    } else if (problem.startsWith('Off variant')) {
      result.offVariant.push(problem)
    } else {
      result.summary.push(problem)
    }
  }
  return result
}

/**
 * Validates an environment config with the engine and sorts the problems by section.
 * Memoised on the flag, the config and the set of segment keys.
 */
export function useTargetingProblems(
  flag: FlagDefinition,
  value: FlagEnvironmentConfig,
  segmentKeys: string[],
): TargetingProblems {
  const keySignature = segmentKeys.join('\u0000')
  // biome-ignore lint/correctness/useExhaustiveDependencies: segmentKeys is tracked through its signature so callers may pass a fresh array every render
  return useMemo(
    () => sortProblems(value, validateEnvironmentConfig(flag, value, segmentKeys)),
    [flag, value, keySignature],
  )
}

export interface TargetingEditorProps {
  flag: FlagDefinition
  value: FlagEnvironmentConfig
  onChange: (value: FlagEnvironmentConfig) => void
  segments: SegmentOption[]
  environment: EnvironmentLike
  attributeSuggestions?: string[]
  disabled?: boolean
  /**
   * Called instead of `onChange` when the user flips the status switch, so the parent can
   * ask for confirmation (for example in production). Without it the change is applied directly.
   */
  onToggleRequest?: (enabled: boolean) => void
  className?: string
}

const ITEM_TRANSITION = { duration: 0.2, ease: 'easeOut' } as const

export function TargetingEditor({
  flag,
  value,
  onChange,
  segments,
  environment,
  attributeSuggestions,
  disabled,
  onToggleRequest,
  className,
}: TargetingEditorProps) {
  const switchId = useId()
  const segmentKeys = useMemo(() => segments.map((segment) => segment.key), [segments])
  const problems = useTargetingProblems(flag, value, segmentKeys)

  function toggle(enabled: boolean) {
    if (onToggleRequest) onToggleRequest(enabled)
    else onChange({ ...value, enabled })
  }

  function setRule(index: number, rule: Rule) {
    onChange({ ...value, rules: value.rules.map((r, i) => (i === index ? rule : r)) })
  }

  function removeRule(index: number) {
    onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) })
  }

  function moveRule(index: number, direction: 'up' | 'down') {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= value.rules.length) return
    const rules = [...value.rules]
    const [moved] = rules.splice(index, 1)
    if (!moved) return
    rules.splice(target, 0, moved)
    onChange({ ...value, rules })
  }

  function addRule() {
    const rule: Rule = {
      id: newId(),
      conditions: [],
      serve: { type: 'variant', variant: primaryVariant(value.fallthrough, flag.variants) },
    }
    onChange({ ...value, rules: [...value.rules, rule] })
  }

  return (
    <MotionConfig reducedMotion="user">
      <div style={envStyle(environment)} className={cn('flex flex-col gap-6', className)}>
        {problems.summary.length > 0 ? (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>
              {pluralize(problems.summary.length, 'problem')} to fix before saving
            </AlertTitle>
            <AlertDescription>
              <ul className="list-inside list-disc">
                {problems.summary.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <Section
          title="Status"
          headerClassName={cn(environment.isProduction && 'hazard-stripes')}
          action={<EnvBadge env={environment} className="bg-card" />}
        >
          <div className="flex items-center gap-3">
            <Switch
              id={switchId}
              checked={value.enabled}
              onCheckedChange={toggle}
              disabled={disabled}
              aria-label={`${value.enabled ? 'Disable' : 'Enable'} ${flag.key} in ${environment.name}`}
              className="data-[state=checked]:bg-on"
            />
            <Label htmlFor={switchId} className="text-sm font-normal">
              Flag is {value.enabled ? 'on' : 'off'} in{' '}
              <span className="font-medium">{environment.name}</span>
            </Label>
          </div>
        </Section>

        <Section
          title="When off, serve"
          description="Served while the flag is off. Rules and the default below are skipped."
        >
          <div className="max-w-sm">
            <VariantSelect
              variants={flag.variants}
              type={flag.type}
              value={value.offVariant}
              onValueChange={(offVariant) => onChange({ ...value, offVariant })}
              disabled={disabled}
              aria-label="Variant served when the flag is off"
              aria-invalid={problems.offVariant.length > 0}
            />
          </div>
          <ProblemList problems={problems.offVariant} />
        </Section>

        <Section
          title="Targeting rules"
          description={
            value.enabled
              ? 'Evaluated top to bottom. The first rule that matches decides.'
              : 'Not evaluated while the flag is off.'
          }
          bare
        >
          <div className="flex flex-col gap-3">
            {value.rules.length === 0 ? (
              <Empty className="rounded-lg border p-5 md:p-5">
                <EmptyHeader>
                  <EmptyDescription>
                    No targeting rules. Everyone who is not matched receives the default below.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="relative flex flex-col gap-3">
                <AnimatePresence initial={false} mode="popLayout">
                  {value.rules.map((rule, index) => (
                    <motion.div
                      key={rule.id}
                      layout="position"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={ITEM_TRANSITION}
                    >
                      <RuleCard
                        rule={rule}
                        index={index}
                        total={value.rules.length}
                        flag={flag}
                        segments={segments}
                        attributeSuggestions={attributeSuggestions}
                        disabled={disabled}
                        problems={problems.rules[index]}
                        onChange={(next) => setRule(index, next)}
                        onRemove={() => removeRule(index)}
                        onMove={(direction) => moveRule(index, direction)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRule}
                disabled={disabled}
              >
                <PlusIcon aria-hidden="true" />
                Add rule
              </Button>
            </div>
          </div>
        </Section>

        <Section
          title="Default (fallthrough)"
          description="Served when the flag is on and no rule matches."
        >
          <ServeEditor
            flag={flag}
            value={value.fallthrough}
            onChange={(fallthrough) => onChange({ ...value, fallthrough })}
            disabled={disabled}
            label="Serve"
          />
          <ProblemList problems={problems.fallthrough} />
        </Section>
      </div>
    </MotionConfig>
  )
}

function ProblemList({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null
  return (
    <ul className="mt-2 flex flex-col gap-0.5">
      {problems.map((problem) => (
        <li key={problem} className="text-destructive text-xs">
          {problem}
        </li>
      ))}
    </ul>
  )
}

function Section({
  title,
  description,
  action,
  headerClassName,
  className,
  bare,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  headerClassName?: string
  className?: string
  /** No surrounding card; for sections that contain cards of their own. */
  bare?: boolean
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn(!bare && 'overflow-hidden rounded-lg border bg-card', className)}
    >
      <header
        className={cn(
          'flex items-center justify-between gap-3',
          bare ? 'mb-3 px-0.5' : 'border-b px-4 py-2.5',
          headerClassName,
        )}
      >
        <div className="min-w-0">
          <h3 id={headingId} className="font-medium text-sm">
            {title}
          </h3>
          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className={cn(!bare && 'p-4')}>{children}</div>
    </section>
  )
}
