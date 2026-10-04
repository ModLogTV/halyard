import type { FlagType, Variant } from '@halyard/engine'
import { validateFlagDefinition } from '@halyard/engine'
import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { TagInput, VariantSelect, VariantsEditor } from '@/components/flags'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { createFlag } from '@/server/functions/flags'

const projectRoute = getRouteApi('/app/$projectSlug')

export const Route = createFileRoute('/app/$projectSlug/flags/new')({
  staticData: { crumb: 'New flag' },
  component: NewFlagPage,
})

const TYPE_OPTIONS: { value: FlagType; label: string; description: string }[] = [
  { value: 'boolean', label: 'Boolean', description: 'On or off. The most common kind of flag.' },
  {
    value: 'string',
    label: 'String',
    description: 'Pick one of several text values, for example a banner text.',
  },
  {
    value: 'number',
    label: 'Number',
    description: 'Pick one of several numeric values, for example a limit.',
  },
  { value: 'json', label: 'JSON', description: 'Structured configuration objects.' },
]

function defaultVariants(type: FlagType): Variant[] {
  switch (type) {
    case 'boolean':
      return [
        { key: 'on', value: true },
        { key: 'off', value: false },
      ]
    case 'string':
      return [
        { key: 'control', value: 'control' },
        { key: 'treatment', value: 'treatment' },
      ]
    case 'number':
      return [
        { key: 'low', value: 10 },
        { key: 'high', value: 100 },
      ]
    case 'json':
      return [
        { key: 'default', value: {} },
        { key: 'variant-b', value: {} },
      ]
  }
}

function keyify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+/g, '-')
}

function NewFlagPage() {
  const { project } = projectRoute.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [type, setType] = useState<FlagType>('boolean')
  const [variants, setVariants] = useState<Variant[]>(defaultVariants('boolean'))
  const [variantsValid, setVariantsValid] = useState(true)
  const [tags, setTags] = useState<string[]>([])
  const [offVariant, setOffVariant] = useState('off')
  const [defaultVariant, setDefaultVariant] = useState('on')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problems = useMemo(
    () => (key ? validateFlagDefinition({ key, type, variants }) : []),
    [key, type, variants],
  )

  function changeType(next: FlagType) {
    setType(next)
    const v = defaultVariants(next)
    setVariants(v)
    setOffVariant(v[v.length - 1]?.key ?? '')
    setDefaultVariant(v[0]?.key ?? '')
  }

  function changeVariants(next: Variant[]) {
    setVariants(next)
    if (!next.some((v) => v.key === offVariant)) setOffVariant(next[next.length - 1]?.key ?? '')
    if (!next.some((v) => v.key === defaultVariant)) setDefaultVariant(next[0]?.key ?? '')
  }

  const canSubmit =
    name.trim().length > 0 &&
    key.length > 0 &&
    problems.length === 0 &&
    variantsValid &&
    offVariant &&
    defaultVariant

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setError(null)
    try {
      await createFlag({
        data: {
          projectId: project.id,
          key,
          name: name.trim(),
          description: description.trim() || undefined,
          type,
          variants,
          tags,
          offVariant,
          defaultVariant,
        },
      })
      toast.success(`Flag ${key} created`)
      await router.invalidate()
      await navigate({
        to: '/app/$projectSlug/flags/$flagKey',
        params: { projectSlug: project.slug, flagKey: key },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the flag')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/flags" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> Flags
          </Link>
        </Button>
        <PageHeader
          title="New flag"
          description="A flag is defined once per project and configured separately in each environment. It starts switched off everywhere."
        />
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
            <CardDescription>
              Key and type cannot be changed after the flag is created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  autoFocus
                  placeholder="New payment flow"
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!keyTouched) setKey(keyify(e.target.value))
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="key">Key</FieldLabel>
                <Input
                  id="key"
                  value={key}
                  className="font-mono"
                  placeholder="checkout.new-payment-flow"
                  onChange={(e) => {
                    setKeyTouched(true)
                    setKey(keyify(e.target.value))
                  }}
                  aria-invalid={problems.some((p) => p.toLowerCase().includes('key'))}
                />
                <FieldDescription>
                  Used in code and the API. Letters, numbers, dots, dashes and underscores.
                  Prefixing by area (for example <span className="font-mono">checkout.</span>) keeps
                  the list tidy.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="description">Description</FieldLabel>
                <Textarea
                  id="description"
                  rows={2}
                  value={description}
                  placeholder="What does this flag control, and when can it be removed?"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Tags</FieldLabel>
                <TagInput
                  aria-label="Tags"
                  values={tags}
                  onChange={setTags}
                  placeholder="Add a tag and press Enter"
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Type and variants</CardTitle>
            <CardDescription>Variants are the values a flag can resolve to.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <FieldSet>
                <FieldLegend>Type</FieldLegend>
                <RadioGroup
                  value={type}
                  onValueChange={(v) => changeType(v as FlagType)}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {TYPE_OPTIONS.map((option) => (
                    <Field
                      key={option.value}
                      orientation="horizontal"
                      className="items-start rounded-lg border p-3 has-data-[state=checked]:border-primary"
                    >
                      <RadioGroupItem
                        value={option.value}
                        id={`type-${option.value}`}
                        className="mt-0.5"
                      />
                      <div className="grid gap-0.5">
                        <FieldLabel htmlFor={`type-${option.value}`} className="font-medium">
                          {option.label}
                        </FieldLabel>
                        <FieldDescription>{option.description}</FieldDescription>
                      </div>
                    </Field>
                  ))}
                </RadioGroup>
              </FieldSet>
              <Field>
                <FieldLabel>Variants</FieldLabel>
                <VariantsEditor
                  type={type}
                  value={variants}
                  onChange={changeVariants}
                  onValidityChange={setVariantsValid}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="off-variant">Serve when off</FieldLabel>
                  <VariantSelect
                    id="off-variant"
                    variants={variants}
                    type={type}
                    value={offVariant}
                    onValueChange={setOffVariant}
                  />
                  <FieldDescription>Returned while the flag is disabled.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="default-variant">Default when on</FieldLabel>
                  <VariantSelect
                    id="default-variant"
                    variants={variants}
                    type={type}
                    value={defaultVariant}
                    onValueChange={setDefaultVariant}
                  />
                  <FieldDescription>Returned when no targeting rule matches.</FieldDescription>
                </Field>
              </div>
              {problems.length > 0 ? <FieldError>{problems.join(' ')}</FieldError> : null}
            </FieldGroup>
          </CardContent>
        </Card>

        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="ghost">
            <Link to="/app/$projectSlug/flags" params={{ projectSlug: project.slug }}>
              Cancel
            </Link>
          </Button>
          <Button type="submit" disabled={!canSubmit || pending}>
            {pending ? <Spinner /> : null}
            Create flag
          </Button>
        </div>
      </form>
    </div>
  )
}
