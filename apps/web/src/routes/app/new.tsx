import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { HalyardMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { createProject } from '@/server/functions/projects'

export const Route = createFileRoute('/app/new')({
  head: () => ({ meta: [{ title: 'New project · Halyard' }] }),
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
      toast.success(`Project "${project.name}" created`)
      await router.invalidate()
      await navigate({ to: '/app/$projectSlug', params: { projectSlug: project.slug } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create project')
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
          <ArrowLeftIcon /> All projects
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Create a project</CardTitle>
          <CardDescription>
            Projects come with development, staging and production environments. You can rename or
            add environments later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (!slugTouched) setSlug(slugify(e.target.value))
                  }}
                  placeholder="Checkout"
                  required
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="slug">Slug</FieldLabel>
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
                <FieldDescription>
                  Used in URLs and the CLI. Lowercase letters, numbers and dashes.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="description">Description</FieldLabel>
                <Textarea id="description" name="description" rows={2} placeholder="Optional" />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Field orientation="horizontal" className="justify-end">
                <Button type="submit" disabled={pending || !name.trim() || !slug.trim()}>
                  {pending ? <Spinner /> : null}
                  Create project
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
