import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon, FlagIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ExperimentForm, type ExperimentFormValues } from '@/components/experiments'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { createExperiment } from '@/server/functions/experiments'
import { listFlags } from '@/server/functions/flags'

const projectRoute = getRouteApi('/app/$projectSlug')

export const Route = createFileRoute('/app/$projectSlug/experiments/new')({
  staticData: { crumbKey: 'newExperiment' },
  validateSearch: z.object({
    flag: z.string().optional().catch(undefined),
    env: z.string().optional().catch(undefined),
  }),
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const flags = await listFlags({ data: { projectId: parent.loaderData!.projectId } })
    return { flags }
  },
  pendingComponent: () => (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  ),
  component: NewExperimentPage,
})

function NewExperimentPage() {
  const { flags } = Route.useLoaderData()
  const { project } = projectRoute.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const environments = useMemo(
    () => [...project.environments].sort((a, b) => a.sortOrder - b.sortOrder),
    [project.environments],
  )
  const flagOptions = useMemo(
    () =>
      flags
        .filter((f) => !f.archivedAt)
        .map((f) => ({ key: f.key, name: f.name, type: f.type, variants: f.variants })),
    [flags],
  )

  async function onSubmit(values: ExperimentFormValues) {
    setPending(true)
    setError(null)
    try {
      await createExperiment({
        data: {
          projectId: project.id,
          flagKey: values.flagKey,
          environmentKey: values.environmentKey,
          key: values.key,
          name: values.name,
          hypothesis: values.hypothesis || undefined,
          allocation: values.allocation,
          conversionEvent: values.conversionEvent,
          controlVariant: values.controlVariant,
        },
      })
      toast.success(`Experiment ${values.key} created as a draft`)
      await router.invalidate()
      await navigate({
        to: '/app/$projectSlug/experiments/$experimentKey',
        params: { projectSlug: project.slug, experimentKey: values.key },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the experiment')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/experiments" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> Experiments
          </Link>
        </Button>
        <PageHeader
          title="New experiment"
          description="The experiment is created as a draft. Nothing is served until you start it."
        />
      </div>

      {flagOptions.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlagIcon />
            </EmptyMedia>
            <EmptyTitle>You need a flag first</EmptyTitle>
            <EmptyDescription>
              Experiments split the variants of a flag. Create a flag with at least two variants.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/app/$projectSlug/flags/new" params={{ projectSlug: project.slug }}>
                Create a flag
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader>
              <CardTitle>Design</CardTitle>
              <CardDescription>
                Flag, environment and key cannot be changed once the experiment exists.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ExperimentForm
                mode="create"
                flags={flagOptions}
                environments={environments}
                initial={{
                  flagKey: search.flag,
                  environmentKey: environments.find((e) => e.key === search.env)?.key,
                }}
                pending={pending}
                error={error}
                submitLabel="Create draft"
                onSubmit={onSubmit}
                actions={
                  <Button asChild variant="ghost">
                    <Link to="/app/$projectSlug/experiments" params={{ projectSlug: project.slug }}>
                      Cancel
                    </Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>

          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-muted-foreground text-sm">
              <p>
                Contexts that reach the flag's default, meaning no targeting rule matched, are split
                across the variants by the allocation. The same user always sees the same variant.
              </p>
              <p>
                An exposure is recorded the first time a user is evaluated. Conversions are sent
                with the tracking endpoint using the conversion event name.
              </p>
              <p>
                Results compare each variant with the control using a two-proportion z-test and need
                a minimum sample before they can be called.
              </p>
              <p>
                The method and its limits are described in{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs">
                  docs/experiments.md
                </code>{' '}
                in the repository.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
