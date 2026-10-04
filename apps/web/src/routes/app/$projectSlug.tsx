import { createFileRoute, getRouteApi, notFound, Outlet } from '@tanstack/react-router'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Breadcrumbs } from '@/components/layout/breadcrumbs'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { getProject } from '@/server/functions/projects'

const appRoute = getRouteApi('/app')

export const Route = createFileRoute('/app/$projectSlug')({
  loader: async ({ params }) => {
    const project = await getProject({ data: { slug: params.projectSlug } })
    if (!project) throw notFound()
    return { project }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.project.name ?? 'Project'} · Halyard` }],
  }),
  component: ProjectLayout,
})

function ProjectLayout() {
  const { project } = Route.useLoaderData()
  const { projects } = appRoute.useLoaderData()
  const { user } = appRoute.useRouteContext()
  const current = projects.find((p) => p.id === project.id) ?? {
    id: project.id,
    name: project.name,
    slug: project.slug,
    role: 'viewer',
  }

  return (
    <SidebarProvider>
      <AppSidebar projects={projects} current={current} user={user} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumbs projectName={project.name} projectSlug={project.slug} />
        </header>
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
