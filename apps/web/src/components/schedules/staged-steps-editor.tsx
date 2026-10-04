import type { Variant } from '@halyard/engine'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { newId, RolloutBar } from '@/components/flags'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DateTimePicker } from './date-time-picker'
import {
  DAY,
  type DraftStep,
  describeRollout,
  formatDelta,
  roundedFromNow,
  type StepProblems,
  stagedRolloutServe,
} from './utils'

const MAX_STEPS = 50

/** Default ramp: 10 % in 1 h, then 25 %, 50 % and 100 % on the following days. */
export function defaultSteps(now = Date.now()): DraftStep[] {
  return [
    { id: newId(), percentage: '10', at: roundedFromNow(60 * 60_000, now) },
    { id: newId(), percentage: '25', at: roundedFromNow(DAY, now) },
    { id: newId(), percentage: '50', at: roundedFromNow(2 * DAY, now) },
    { id: newId(), percentage: '100', at: roundedFromNow(3 * DAY, now) },
  ]
}

export function StagedStepsEditor({
  steps,
  onChange,
  variants,
  variant,
  problems,
  now,
  disabled,
}: {
  steps: DraftStep[]
  onChange: (steps: DraftStep[]) => void
  variants: Variant[]
  /** The variant that gets ramped up. */
  variant: string
  problems: StepProblems[]
  now: Date
  disabled?: boolean
}) {
  const keys = variants.map((v) => v.key)

  function update(id: string, patch: Partial<DraftStep>) {
    onChange(steps.map((step) => (step.id === id ? { ...step, ...patch } : step)))
  }

  function addStep() {
    const last = steps[steps.length - 1]
    const lastPercentage = Number(last?.percentage)
    onChange([
      ...steps,
      {
        id: newId(),
        percentage: String(
          Number.isFinite(lastPercentage) ? Math.min(100, Math.max(lastPercentage + 25, 1)) : 100,
        ),
        at: new Date((last?.at.getTime() ?? Date.now()) + DAY),
      },
    ])
  }

  return (
    <MotionConfig reducedMotion="user">
      <ol className="flex flex-col gap-2" aria-label="Rollout steps">
        <AnimatePresence initial={false}>
          {steps.map((step, index) => {
            const problem = problems[index] ?? {}
            const percentage = Number(step.percentage)
            const valid = Number.isFinite(percentage) && percentage >= 0 && percentage <= 100
            const serve = valid ? stagedRolloutServe(keys, variant, percentage) : null
            return (
              <motion.li
                key={step.id}
                layout="position"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="mt-2 w-12 shrink-0 font-medium text-muted-foreground text-xs">
                      Step {index + 1}
                    </span>
                    <div className="flex w-28 flex-col gap-1">
                      <InputGroup>
                        <InputGroupInput
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          step="any"
                          value={step.percentage}
                          disabled={disabled}
                          aria-label={`Step ${index + 1} percentage`}
                          aria-invalid={Boolean(problem.percentage) || undefined}
                          className="tabular-nums"
                          onChange={(event) => update(step.id, { percentage: event.target.value })}
                        />
                        <InputGroupAddon align="inline-end">%</InputGroupAddon>
                      </InputGroup>
                      {problem.percentage ? (
                        <p className="text-destructive text-xs">{problem.percentage}</p>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
                      <DateTimePicker
                        value={step.at}
                        onChange={(at) => update(step.id, { at })}
                        disabled={disabled}
                        invalid={Boolean(problem.at)}
                        aria-label={`Step ${index + 1}`}
                      />
                      {problem.at ? (
                        <p className="text-destructive text-xs">{problem.at}</p>
                      ) : (
                        <p className="text-muted-foreground text-xs">{formatDelta(step.at, now)}</p>
                      )}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove step ${index + 1}`}
                          disabled={disabled || steps.length <= 1}
                          onClick={() => onChange(steps.filter((s) => s.id !== step.id))}
                        >
                          <Trash2Icon />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remove step</TooltipContent>
                    </Tooltip>
                  </div>
                  {serve ? (
                    <div className="flex flex-col gap-1 pl-15">
                      <RolloutBar variations={serve.variations} variants={variants} />
                      <p className="font-mono text-muted-foreground text-xs">
                        {describeRollout(serve.variations)}
                      </p>
                    </div>
                  ) : null}
                </div>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ol>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addStep}
          disabled={disabled || steps.length >= MAX_STEPS}
        >
          <PlusIcon /> Add step
        </Button>
      </div>
    </MotionConfig>
  )
}
