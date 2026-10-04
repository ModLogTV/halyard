import { createFileRoute, getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon, FlagIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
import { translate } from '@/lib/i18n'
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
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('experiments:new.pageTitle') }],
  }),
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
  const { t } = useTranslation(['experiments', 'common'])
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
      toast.success(t('new.toastCreated', { key: values.key }))
      await router.invalidate()
      await navigate({
        to: '/app/$projectSlug/experiments/$experimentKey',
        params: { projectSlug: project.slug, experimentKey: values.key },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('new.createFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/app/$projectSlug/experiments" params={{ projectSlug: project.slug }}>
            <ArrowLeftIcon /> {t('common:labels.experiments')}
          </Link>
        </Button>
        <PageHeader title={t('new.title')} description={t('new.description')} />
      </div>

      {flagOptions.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlagIcon />
            </EmptyMedia>
            <EmptyTitle>{t('new.needFlag.title')}</EmptyTitle>
            <EmptyDescription>{t('new.needFlag.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/app/$projectSlug/flags/new" params={{ projectSlug: project.slug }}>
                {t('new.needFlag.action')}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader>
              <CardTitle>{t('new.design.title')}</CardTitle>
              <CardDescription>{t('new.design.description')}</CardDescription>
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
                submitLabel={t('new.submit')}
                onSubmit={onSubmit}
                actions={
                  <Button asChild variant="ghost">
                    <Link to="/app/$projectSlug/experiments" params={{ projectSlug: project.slug }}>
                      {t('common:actions.cancel')}
                    </Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>

          <Card className="lg:sticky lg:top-6">
            <CardHeader>
              <CardTitle>{t('new.howItWorks.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-muted-foreground text-sm">
              <p>{t('new.howItWorks.split')}</p>
              <p>{t('new.howItWorks.exposure')}</p>
              <p>{t('new.howItWorks.results')}</p>
              <p>
                <Trans
                  t={t}
                  i18nKey="new.howItWorks.docs"
                  values={{ path: 'docs/experiments.md' }}
                  components={[
                    <code
                      key="docs"
                      className="rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs"
                    />,
                  ]}
                />
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
