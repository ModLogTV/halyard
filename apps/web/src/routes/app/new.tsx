import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { HalyardMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/lib/i18n'
import { createProject } from '@/server/functions/projects'

export const Route = createFileRoute('/app/new')({
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('projects:newProject.pageTitle') }],
  }),
  component: NewProjectPage,
})

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function NewProjectPage() {
  const { t } = useTranslation(['projects', 'common'])
  const navigate = useNavigate()
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const project = await createProject({
        data: {
          name: name.trim(),
          slug: slug.trim(),
          description: String(form.get('description') ?? '').trim() || undefined,
        },
      })
      toast.success(t('newProject.created', { name: project.name }))
      await router.invalidate()
      await navigate({ to: '/app/$projectSlug', params: { projectSlug: project.slug } })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('newProject.createFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg p-6 md:p-10">
      <div className="mb-8 flex items-center gap-2.5">
        <HalyardMark className="size-7" />
        <span className="font-semibold tracking-tight">Halyard</span>
      </div>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/app">
          <ArrowLeftIcon /> {t('newProject.allProjects')}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{t('newProject.title')}</CardTitle>
          <CardDescription>{t('newProject.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">{t('common:labels.name')}</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!slugTouched) setSlug(slugify(e.target.value))
                  }}
                  placeholder={t('newProject.form.namePlaceholder')}
                  required
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="slug">{t('newProject.form.slugLabel')}</FieldLabel>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setSlug(slugify(e.target.value))
                  }}
                  className="font-mono"
                  required
                />
                <FieldDescription>{t('newProject.form.slugHint')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="description">{t('common:labels.description')}</FieldLabel>
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  placeholder={t('newProject.form.optionalPlaceholder')}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Field orientation="horizontal" className="justify-end">
                <Button type="submit" disabled={pending || !name.trim() || !slug.trim()}>
                  {pending ? <Spinner /> : null}
                  {t('newProject.form.submit')}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
