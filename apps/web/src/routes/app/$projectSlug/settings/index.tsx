import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/settings/confirm-dialog'
import { errorMessage } from '@/components/settings/form-utils'
import { HintedButton } from '@/components/settings/hinted-button'
import { SettingsPending } from '@/components/settings/settings-section'
import { OWNER_ONLY_MESSAGE, useSettingsContext } from '@/components/settings/use-settings-context'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { leaveProject, listMembers } from '@/server/functions/members'
import { deleteProject, updateProject } from '@/server/functions/projects'
import { updateProjectSchema } from '@/server/schemas/projects'

export const Route = createFileRoute('/app/$projectSlug/settings/')({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData?.projectId
    if (!projectId) return { ownerCount: 0 }
    const { members } = await listMembers({ data: { projectId } })
    return { ownerCount: members.filter((m) => m.role === 'owner').length }
  },
  head: () => ({ meta: [{ title: 'General settings · Halyard' }] }),
  pendingComponent: () => <SettingsPending rows={4} />,
  component: GeneralSettings,
})

type FieldName = 'name' | 'description' | 'staleAfterDays' | 'singleVariantAfterDays'

function parseDays(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}

function GeneralSettings() {
  return (
    <div className="flex flex-col gap-8">
      <ProjectForm />
      <DangerZone />
    </div>
  )
}

function ProjectForm() {
  const router = useRouter()
  const { project, isOwner } = useSettingsContext()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [staleAfter, setStaleAfter] = useState(String(project.staleAfterDays))
  const [singleAfter, setSingleAfter] = useState(String(project.singleVariantAfterDays))
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const patch = {
    ...(name.trim() !== project.name && { name: name.trim() }),
    ...(description.trim() !== (project.description ?? '') && {
      description: description.trim() === '' ? null : description.trim(),
    }),
    ...(parseDays(staleAfter) !== project.staleAfterDays && {
      staleAfterDays: parseDays(staleAfter),
    }),
    ...(parseDays(singleAfter) !== project.singleVariantAfterDays && {
      singleVariantAfterDays: parseDays(singleAfter),
    }),
  }
  const dirty = Object.keys(patch).length > 0

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isOwner || !dirty) return
    const parsed = updateProjectSchema.shape.patch.safeParse(patch)
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName | undefined
        if (!field || next[field]) continue
        next[field] =
          field === 'staleAfterDays' || field === 'singleVariantAfterDays'
            ? 'Enter a whole number of days between 1 and 3650'
            : issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    setServerError(null)
    setPending(true)
    try {
      await updateProject({ data: { projectId: project.id, patch: parsed.data } })
      toast.success('Project settings saved')
      await router.invalidate()
    } catch (error) {
      setServerError(errorMessage(error, 'Could not save the settings'))
    } finally {
      setPending(false)
    }
  }

  function reset() {
    setName(project.name)
    setDescription(project.description ?? '')
    setStaleAfter(String(project.staleAfterDays))
    setSingleAfter(String(project.singleVariantAfterDays))
    setErrors({})
    setServerError(null)
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>Project</CardTitle>
          <CardDescription>
            {isOwner
              ? 'Name and describe the project, and decide when flags count as cleanup candidates.'
              : 'Only owners can change these settings.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-6">
          <FieldGroup>
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!isOwner}
                aria-invalid={errors.name ? true : undefined}
                maxLength={100}
              />
              <FieldError>{errors.name}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
              <Input id="project-slug" value={project.slug} readOnly className="font-mono" />
              <FieldDescription>
                Used in URLs and the CLI. The slug cannot be changed.
              </FieldDescription>
            </Field>
            <Field data-invalid={errors.description ? true : undefined}>
              <FieldLabel htmlFor="project-description">Description</FieldLabel>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                disabled={!isOwner}
                placeholder="What is this project for?"
                aria-invalid={errors.description ? true : undefined}
              />
              <FieldError>{errors.description}</FieldError>
            </Field>

            <Separator />

            <FieldSet>
              <FieldLegend>Flag cleanup</FieldLegend>
              <FieldDescription>
                Flags that match these rules are listed as cleanup candidates, so dead code and
                forgotten rollouts do not pile up.
              </FieldDescription>
              <div className="grid gap-6 sm:grid-cols-2">
                <Field data-invalid={errors.staleAfterDays ? true : undefined}>
                  <FieldLabel htmlFor="stale-after">Stale after (days)</FieldLabel>
                  <Input
                    id="stale-after"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={3650}
                    step={1}
                    value={staleAfter}
                    onChange={(event) => setStaleAfter(event.target.value)}
                    disabled={!isOwner}
                    aria-invalid={errors.staleAfterDays ? true : undefined}
                  />
                  {errors.staleAfterDays ? (
                    <FieldError>{errors.staleAfterDays}</FieldError>
                  ) : (
                    <FieldDescription>
                      A flag is stale when it has had no changes for this long.
                    </FieldDescription>
                  )}
                </Field>
                <Field data-invalid={errors.singleVariantAfterDays ? true : undefined}>
                  <FieldLabel htmlFor="single-after">Single variant after (days)</FieldLabel>
                  <Input
                    id="single-after"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={3650}
                    step={1}
                    value={singleAfter}
                    onChange={(event) => setSingleAfter(event.target.value)}
                    disabled={!isOwner}
                    aria-invalid={errors.singleVariantAfterDays ? true : undefined}
                  />
                  {errors.singleVariantAfterDays ? (
                    <FieldError>{errors.singleVariantAfterDays}</FieldError>
                  ) : (
                    <FieldDescription>
                      A flag is a cleanup candidate when it has served only one variant to everyone
                      for this long.
                    </FieldDescription>
                  )}
                </Field>
              </div>
            </FieldSet>
            {serverError ? <FieldError>{serverError}</FieldError> : null}
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 justify-end gap-2 border-t pt-6">
          {dirty && isOwner ? (
            <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
              Discard changes
            </Button>
          ) : null}
          <HintedButton
            type="submit"
            disabledReason={isOwner ? undefined : OWNER_ONLY_MESSAGE}
            disabled={pending || !dirty}
          >
            {pending ? <Spinner /> : null}
            Save changes
          </HintedButton>
        </CardFooter>
      </form>
    </Card>
  )
}

function DangerZone() {
  const router = useRouter()
  const navigate = useNavigate()
  const { project, isOwner } = useSettingsContext()
  const { ownerCount } = Route.useLoaderData()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)

  const soleOwner = isOwner && ownerCount <= 1

  async function leaveAndExit() {
    await leaveProject({ data: { projectId: project.id } })
    toast.success(`You left ${project.name}`)
    await navigate({ to: '/app' })
    await router.invalidate()
  }

  async function deleteAndExit() {
    await deleteProject({ data: { projectId: project.id } })
    toast.success(`Project "${project.name}" deleted`)
    await navigate({ to: '/app' })
    await router.invalidate()
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>These actions affect your access or remove data for good.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Leave project</ItemTitle>
            <ItemDescription>
              You lose access to {project.name} until an owner invites you again.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <HintedButton
              variant="outline"
              onClick={() => setLeaveOpen(true)}
              disabledReason={
                soleOwner
                  ? 'You are the only owner. Make another member an owner first.'
                  : undefined
              }
            >
              Leave project
            </HintedButton>
          </ItemActions>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Delete project</ItemTitle>
            <ItemDescription>
              Permanently delete the project with its flags, segments, environments, SDK keys and
              audit log.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <HintedButton
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              disabledReason={isOwner ? undefined : OWNER_ONLY_MESSAGE}
            >
              Delete project
            </HintedButton>
          </ItemActions>
        </Item>
      </CardContent>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={`Leave ${project.name}?`}
        description="You will lose access to this project. An owner can invite you again."
        confirmLabel="Leave project"
        onConfirm={leaveAndExit}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${project.name}?`}
        description={
          <>
            This permanently deletes all flags, segments, environments, API keys and the audit log
            of this project. SDKs using its keys will stop receiving flags.
          </>
        }
        requireText={project.slug}
        confirmLabel="Delete project"
        onConfirm={deleteAndExit}
      />
    </Card>
  )
}
