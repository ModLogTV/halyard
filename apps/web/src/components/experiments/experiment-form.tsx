import { isValidKey, type RolloutVariation } from '@halyard/engine'
import { TriangleAlertIcon } from 'lucide-react'
import { type FormEvent, type ReactNode, useMemo, useState } from 'react'
import { EnvBadge, EnvDot, envStyle } from '@/components/env/env-badge'
import { evenSplit, FlagTypeBadge, VariantValue } from '@/components/flags'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { AllocationEditor } from './allocation-editor'
import {
  allocationForFlag,
  allocationIsComplete,
  defaultControl,
  type EnvironmentOption,
  type FlagOption,
  keyify,
} from './utils'

export interface ExperimentFormValues {
  flagKey: string
  environmentKey: string
  key: string
  name: string
  hypothesis: string
  /** Only variants with a weight above 0, in flag order. */
  allocation: RolloutVariation[]
  controlVariant: string
  conversionEvent: string
}

export interface ExperimentFormProps {
  mode: 'create' | 'edit'
  /** Non-archived flags to choose from. In edit mode only the experiment's flag. */
  flags: FlagOption[]
  environments: EnvironmentOption[]
  initial?: Partial<Omit<ExperimentFormValues, 'allocation'>> & { allocation?: RolloutVariation[] }
  pending?: boolean
  error?: string | null
  submitLabel: string
  /** Rendered before the submit button, for example a cancel button. */
  actions?: ReactNode
  onSubmit: (values: ExperimentFormValues) => void
}

/** Creates a draft experiment or edits one (flag, environment and key are fixed in edit mode). */
/** True when the display name is just the key with different separators, e.g. `mod-inventory-search` vs "mod inventory search". */
function nameRepeatsKey(key: string, name: string): boolean {
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return normalise(key) === normalise(name)
}

export function ExperimentForm({
  mode,
  flags,
  environments,
  initial,
  pending = false,
  error,
  submitLabel,
  actions,
  onSubmit,
}: ExperimentFormProps) {
  const editing = mode === 'edit'
  const initialFlag = flags.find((f) => f.key === initial?.flagKey)
  const [flagKey, setFlagKey] = useState(initialFlag?.key ?? '')
  const [environmentKey, setEnvironmentKey] = useState(
    initial?.environmentKey ??
      (environments.find((e) => !e.isProduction) ?? environments[0])?.key ??
      '',
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [key, setKey] = useState(initial?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(editing)
  const [hypothesis, setHypothesis] = useState(initial?.hypothesis ?? '')
  const [conversionEvent, setConversionEvent] = useState(initial?.conversionEvent ?? '')
  const [allocation, setAllocation] = useState<RolloutVariation[]>(() =>
    initialFlag
      ? initial?.allocation
        ? allocationForFlag(initialFlag, initial.allocation)
        : evenSplit(initialFlag.variants.map((v) => v.key))
      : [],
  )
  const [controlVariant, setControlVariant] = useState(
    initial?.controlVariant ?? (initialFlag ? defaultControl(initialFlag) : ''),
  )

  const flag = flags.find((f) => f.key === flagKey)
  const environment = environments.find((e) => e.key === environmentKey)

  // Starts from an even split when the flag changes, because the old weights name other variants.
  function changeFlag(next: string) {
    setFlagKey(next)
    const nextFlag = flags.find((f) => f.key === next)
    if (!nextFlag) return
    setAllocation(evenSplit(nextFlag.variants.map((v) => v.key)))
    setControlVariant(defaultControl(nextFlag))
  }

  const positive = useMemo(
    () => allocation.filter((a) => Number.isFinite(a.weight) && a.weight > 0),
    [allocation],
  )
  const controlOptions = flag
    ? flag.variants
        .map((variant, index) => ({ variant, index }))
        .filter(({ variant }) => positive.some((a) => a.variant === variant.key))
    : []
  const controlValid = controlOptions.some(({ variant }) => variant.key === controlVariant)
  const keyValid = key.length > 0 && isValidKey(key)
  const complete = allocationIsComplete(allocation)

  const problems: string[] = []
  if (flag && positive.length < 2) problems.push('Give at least two variants a weight above 0.')
  if (flag && positive.length >= 2 && !controlValid) {
    problems.push('The control variant needs a weight above 0.')
  }

  const canSubmit =
    Boolean(flag) &&
    Boolean(environment) &&
    name.trim().length > 0 &&
    keyValid &&
    conversionEvent.trim().length > 0 &&
    complete &&
    positive.length >= 2 &&
    controlValid

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || pending) return
    onSubmit({
      flagKey,
      environmentKey,
      key,
      name: name.trim(),
      hypothesis: hypothesis.trim(),
      allocation: positive,
      controlVariant,
      conversionEvent: conversionEvent.trim(),
    })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="experiment-flag">Flag</FieldLabel>
            {editing && flag ? (
              <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                <span className="truncate font-mono">{flag.key}</span>
                <FlagTypeBadge type={flag.type} />
              </div>
            ) : (
              <Select value={flagKey || undefined} onValueChange={changeFlag}>
                <SelectTrigger id="experiment-flag" className="w-full min-w-0">
                  <SelectValue placeholder="Choose a flag">
                    {flag ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-xs">{flag.key}</span>
                        <FlagTypeBadge type={flag.type} />
                      </span>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="w-(--radix-select-trigger-width) max-w-(--radix-select-trigger-width)"
                >
                  {flags.map((f) => (
                    <SelectItem
                      key={f.key}
                      value={f.key}
                      className="items-start *:[span]:last:min-w-0 *:[span]:last:flex-1"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-xs">{f.key}</span>
                          <FlagTypeBadge type={f.type} />
                        </span>
                        {nameRepeatsKey(f.key, f.name) ? null : (
                          <span className="truncate text-muted-foreground text-xs">{f.name}</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <FieldDescription>
              The experiment splits contexts that reach this flag's default.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="experiment-environment">Environment</FieldLabel>
            {editing && environment ? (
              <div className="flex h-9 items-center">
                <EnvBadge env={environment} />
              </div>
            ) : (
              <Select value={environmentKey || undefined} onValueChange={setEnvironmentKey}>
                <SelectTrigger id="experiment-environment" className="w-full min-w-0">
                  <SelectValue placeholder="Choose an environment">
                    {environment ? (
                      <span className="flex items-center gap-2">
                        <EnvDot env={environment} />
                        {environment.name}
                      </span>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent position="popper">
                  {environments.map((env) => (
                    <SelectItem key={env.key} value={env.key}>
                      <EnvDot env={env} />
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>

        {environment?.isProduction ? (
          <div
            style={envStyle(environment)}
            className="hazard-stripes flex items-start gap-2 rounded-lg border border-(--env-color)/40 p-3 text-sm"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-(--env-color)" />
            <p>
              <span className="font-medium">Experiments in production affect real users.</span>{' '}
              <span className="text-muted-foreground">
                Nothing changes until you start it, and you will be asked to confirm.
              </span>
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="experiment-name">Name</FieldLabel>
            <Input
              id="experiment-name"
              value={name}
              autoFocus={!editing}
              placeholder="New payment flow"
              onChange={(e) => {
                setName(e.target.value)
                if (!keyTouched) setKey(keyify(e.target.value))
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="experiment-key">Key</FieldLabel>
            <Input
              id="experiment-key"
              value={key}
              className="font-mono"
              disabled={editing}
              placeholder="new-payment-flow"
              aria-invalid={key.length > 0 && !keyValid}
              onChange={(e) => {
                setKeyTouched(true)
                setKey(keyify(e.target.value))
              }}
            />
            {editing ? null : (
              <FieldDescription>Unique in the project. Cannot be changed later.</FieldDescription>
            )}
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="experiment-hypothesis">Hypothesis</FieldLabel>
          <Textarea
            id="experiment-hypothesis"
            rows={3}
            value={hypothesis}
            maxLength={2000}
            placeholder="If we show the new payment flow, checkout conversion increases because…"
            onChange={(e) => setHypothesis(e.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel>Allocation</FieldLabel>
          {flag ? (
            <AllocationEditor
              flag={flag}
              value={allocation}
              onChange={setAllocation}
              control={controlVariant}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm">
              Choose a flag to split its variants.
            </p>
          )}
          <FieldDescription>
            Percent of contexts that see each variant. The weights must add up to 100.
          </FieldDescription>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="experiment-control">Control variant</FieldLabel>
            <Select
              value={controlValid ? controlVariant : undefined}
              onValueChange={setControlVariant}
              disabled={!flag}
            >
              <SelectTrigger
                id="experiment-control"
                className="w-full min-w-0"
                aria-invalid={Boolean(flag) && positive.length >= 2 && !controlValid}
              >
                <SelectValue placeholder="Select the control" />
              </SelectTrigger>
              <SelectContent position="popper">
                {controlOptions.map(({ variant, index }) => (
                  <SelectItem key={variant.key} value={variant.key}>
                    <VariantValue
                      value={variant.value}
                      type={flag?.type ?? 'string'}
                      variantKey={variant.key}
                      index={index}
                    />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Every other variant is compared with this one.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="experiment-event">Conversion event</FieldLabel>
            <Input
              id="experiment-event"
              value={conversionEvent}
              className="font-mono"
              placeholder="purchase_completed"
              autoComplete="off"
              onChange={(e) => setConversionEvent(e.target.value)}
            />
            <FieldDescription>
              The <span className="font-mono">event</span> name your app sends to the tracking
              endpoint when a user converts.
            </FieldDescription>
          </Field>
        </div>

        {problems.length > 0 ? <FieldError>{problems.join(' ')}</FieldError> : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>

      <div className="flex items-center justify-end gap-2">
        {actions}
        <Button type="submit" disabled={!canSubmit || pending}>
          {pending ? <Spinner /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
