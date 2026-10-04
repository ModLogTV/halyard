import { Link, useNavigate } from '@tanstack/react-router'
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { HalyardMark } from '@/components/brand'
import { useRoleLabel } from '@/components/layout/role-label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export interface ProjectSummary {
  id: string
  name: string
  slug: string
  role: string
}

export function ProjectSwitcher({
  projects,
  current,
}: {
  projects: ProjectSummary[]
  current: ProjectSummary
}) {
  const { t } = useTranslation(['layout', 'common'])
  const roleLabel = useRoleLabel()
  const { isMobile } = useSidebar()
  const navigate = useNavigate()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={current.name}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              aria-label={t('projectSwitcher.ariaLabel', { name: current.name })}
            >
              <HalyardMark className="size-8! shrink-0" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{current.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {roleLabel(current.role)}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('common:labels.projects')}
            </DropdownMenuLabel>
            {projects.map((project, index) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() =>
                  navigate({ to: '/app/$projectSlug', params: { projectSlug: project.slug } })
                }
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border font-mono text-[11px] uppercase">
                  {project.name.slice(0, 2)}
                </div>
                <span className="flex-1 truncate">{project.name}</span>
                {project.id === current.id ? <CheckIcon className="size-4" /> : null}
                {index < 9 ? <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="gap-2 p-2">
              <Link to="/app/new">
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <PlusIcon className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  {t('projectSwitcher.newProject')}
                </div>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
