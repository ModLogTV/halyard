import type { FlagType, Variant } from '@modlogtv/halyard-engine'
import { validateFlagDefinition } from '@modlogtv/halyard-engine'
import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { TagInput, VariantSelect, VariantsEditor } from '@/components/flags'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/lib/i18n'
import { createFlag } from '@/server/functions/flags'

const projectRoute = getRouteApi('/app/$projectSlug')

export const Route = createFileRoute('/app/$projectSlug/flags/new')({
  staticData: { crumbKey: 'newFlag' },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('flags:new.pageTitle') }],
  }),
  component: NewFlagPage,
})

const TYPE_OPTIONS: FlagType[] = ['boolean', 'string', 'number', 'json']

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
  const { t } = useTranslation(['flags', 'common'])
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
      toast.success(t('new.created', { key }))
      await router.invalidate()
      await navigate({
        to: '/app/$projectSlug/flags/$flagKey',
        params: { projectSlug: project.slug, flagKey: key },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('new.createFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/flags" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> {t('common:labels.flags')}
          </Link>
        </Button>
        <PageHeader title={t('new.title')} description={t('new.description')} />
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('new.definition.title')}</CardTitle>
            <CardDescription>{t('new.definition.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">{t('common:labels.name')}</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  autoFocus
                  placeholder={t('new.form.namePlaceholder')}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!keyTouched) setKey(keyify(e.target.value))
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="key">{t('common:labels.key')}</FieldLabel>
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
                  <Trans
                    t={t}
                    i18nKey="new.form.keyHelp"
                    components={[<span key="prefix" className="font-mono" />]}
                  />
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="description">{t('common:labels.description')}</FieldLabel>
                <Textarea
                  id="description"
                  rows={2}
                  value={description}
                  placeholder={t('new.form.descriptionPlaceholder')}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('common:labels.tags')}</FieldLabel>
                <TagInput
                  aria-label={t('common:labels.tags')}
                  values={tags}
                  onChange={setTags}
                  placeholder={t('new.form.tagsPlaceholder')}
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('new.variants.title')}</CardTitle>
            <CardDescription>{t('new.variants.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <FieldSet>
                <FieldLegend>{t('common:labels.type')}</FieldLegend>
                <RadioGroup
                  value={type}
                  onValueChange={(v) => changeType(v as FlagType)}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {TYPE_OPTIONS.map((option) => (
                    <FieldLabel key={option} htmlFor={`type-${option}`}>
                      <Field orientation="horizontal" className="items-start">
                        <RadioGroupItem value={option} id={`type-${option}`} className="mt-0.5" />
                        <FieldContent>
                          <FieldTitle>{t(`common:flagTypes.${option}`)}</FieldTitle>
                          <FieldDescription>{t(`new.types.${option}`)}</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
              </FieldSet>
              <Field>
                <FieldLabel>{t('common:labels.variants')}</FieldLabel>
                <VariantsEditor
                  type={type}
                  value={variants}
                  onChange={changeVariants}
                  onValidityChange={setVariantsValid}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="off-variant">{t('new.form.serveWhenOff')}</FieldLabel>
                  <VariantSelect
                    id="off-variant"
                    variants={variants}
                    type={type}
                    value={offVariant}
                    onValueChange={setOffVariant}
                  />
                  <FieldDescription>{t('new.form.serveWhenOffHelp')}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="default-variant">{t('new.form.defaultWhenOn')}</FieldLabel>
                  <VariantSelect
                    id="default-variant"
                    variants={variants}
                    type={type}
                    value={defaultVariant}
                    onValueChange={setDefaultVariant}
                  />
                  <FieldDescription>{t('new.form.defaultWhenOnHelp')}</FieldDescription>
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
              {t('common:actions.cancel')}
            </Link>
          </Button>
          <Button type="submit" disabled={!canSubmit || pending}>
            {pending ? <Spinner /> : null}
            {t('new.form.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}
