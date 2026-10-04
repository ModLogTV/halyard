import { createFileRoute, getRouteApi, Link, redirect } from '@tanstack/react-router'
import { ArrowRightIcon, FlagIcon, LayersIcon, PlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { HalyardMark } from '@/components/brand'
import { InvitationList } from '@/components/invitations'
import { useRoleLabel } from '@/components/layout/role-label'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { translate } from '@/lib/i18n'
import { listMyInvitations } from '@/server/functions/members'
import { listProjects } from '@/server/functions/projects'

const appRoute = getRouteApi('/app')

export const Route = createFileRoute('/app/')({
  loader: async () => {
    const [projects, invitations] = await Promise.all([listProjects(), listMyInvitations()])
    const only = projects[0]
    if (projects.length === 1 && invitations.length === 0 && only) {
      throw redirect({ to: '/app/$projectSlug', params: { projectSlug: only.slug } })
    }
    return { invitations }
  },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('projects:list.pageTitle') }],
  }),
  component: ProjectsPage,
})

function ProjectsPage() {
  const { t } = useTranslation(['projects', 'common'])
  const roleLabel = useRoleLabel()
  const { invitations } = Route.useLoaderData()
  const { projects } = appRoute.useLoaderData()

  return (
    <div className="mx-auto w-full max-w-5xl p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <HalyardMark className="size-7" />
          <span className="font-semibold tracking-tight">Halyard</span>
        </div>
        <Button asChild>
          <Link to="/app/new">
            <PlusIcon /> {t('list.newProject')}
          </Link>
        </Button>
      </div>

      {invitations.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            {t('list.invitations')}
          </h2>
          <InvitationList invitations={invitations} />
        </section>
      ) : null}

      {projects.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>{t('list.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('list.empty.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/app/new">
                <PlusIcon /> {t('list.empty.create')}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            {t('common:labels.projects')}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to="/app/$projectSlug"
                  params={{ projectSlug: project.slug }}
                  className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="h-full transition-colors group-hover:border-foreground/20">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span className="truncate">{project.name}</span>
                        <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </CardTitle>
                      <CardDescription className="flex items-center gap-3 text-xs">
                        <span className="font-mono">{project.slug}</span>
                        <span className="inline-flex items-center gap-1 tabular">
                          <FlagIcon className="size-3" /> {project.flagCount}
                        </span>
                        <span className="inline-flex items-center gap-1 tabular">
                          <LayersIcon className="size-3" /> {project.environmentCount}
                        </span>
                        <span className="ml-auto">{roleLabel(project.role)}</span>
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
