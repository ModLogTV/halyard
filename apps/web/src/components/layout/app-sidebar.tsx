import { Link } from '@tanstack/react-router'
import {
  CalendarClockIcon,
  ColumnsIcon,
  FlagIcon,
  FlaskConicalIcon,
  HistoryIcon,
  SearchIcon,
  SettingsIcon,
  TerminalSquareIcon,
  UsersRoundIcon,
} from 'lucide-react'
import type { ComponentProps } from 'react'
import { useCommandPalette } from '@/components/command-palette'
import { NavUser } from '@/components/layout/nav-user'
import { type ProjectSummary, ProjectSwitcher } from '@/components/layout/project-switcher'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

const projectNav = [
  { title: 'Flags', to: '/app/$projectSlug/flags', icon: FlagIcon, shortcut: 'F' },
  { title: 'Segments', to: '/app/$projectSlug/segments', icon: UsersRoundIcon, shortcut: 'S' },
  { title: 'Compare', to: '/app/$projectSlug/compare', icon: ColumnsIcon, shortcut: 'C' },
  {
    title: 'Experiments',
    to: '/app/$projectSlug/experiments',
    icon: FlaskConicalIcon,
    shortcut: 'E',
  },
  { title: 'Schedules', to: '/app/$projectSlug/schedules', icon: CalendarClockIcon, shortcut: 'H' },
  {
    title: 'Playground',
    to: '/app/$projectSlug/playground',
    icon: TerminalSquareIcon,
    shortcut: 'P',
  },
  { title: 'Audit log', to: '/app/$projectSlug/audit', icon: HistoryIcon, shortcut: 'A' },
] as const

export function AppSidebar({
  projects,
  current,
  user,
  ...props
}: {
  projects: ProjectSummary[]
  current: ProjectSummary
  user: { name: string; email: string; isAdmin: boolean }
} & ComponentProps<typeof Sidebar>) {
  const palette = useCommandPalette()
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <ProjectSwitcher projects={projects} current={current} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Search (⌘K)" onClick={() => palette.setOpen(true)}>
                <SearchIcon />
                <span className="flex-1">Search</span>
                <KbdGroup className="group-data-[collapsible=icon]:hidden">
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Project</SidebarGroupLabel>
          <SidebarMenu>
            {projectNav.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title}>
                  <Link
                    to={item.to}
                    params={{ projectSlug: current.slug }}
                    activeProps={{ 'data-active': true }}
                    className="data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground"
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Settings">
                <Link
                  to="/app/$projectSlug/settings"
                  params={{ projectSlug: current.slug }}
                  activeProps={{ 'data-active': true }}
                  className="data-active:bg-sidebar-accent data-active:font-medium"
                >
                  <SettingsIcon />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
