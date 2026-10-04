import { Link, useMatchRoute } from '@tanstack/react-router'
import {
  CalendarClockIcon,
  ChartAreaIcon,
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
import { useTranslation } from 'react-i18next'
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
  { titleKey: 'common:labels.flags', to: '/app/$projectSlug/flags', icon: FlagIcon, shortcut: 'F' },
  {
    titleKey: 'sidebar.insights',
    to: '/app/$projectSlug/insights',
    icon: ChartAreaIcon,
    shortcut: 'I',
  },
  {
    titleKey: 'common:labels.segments',
    to: '/app/$projectSlug/segments',
    icon: UsersRoundIcon,
    shortcut: 'S',
  },
  {
    titleKey: 'sidebar.compare',
    to: '/app/$projectSlug/compare',
    icon: ColumnsIcon,
    shortcut: 'C',
  },
  {
    titleKey: 'common:labels.experiments',
    to: '/app/$projectSlug/experiments',
    icon: FlaskConicalIcon,
    shortcut: 'E',
  },
  {
    titleKey: 'common:labels.schedules',
    to: '/app/$projectSlug/schedules',
    icon: CalendarClockIcon,
    shortcut: 'H',
  },
  {
    titleKey: 'common:labels.playground',
    to: '/app/$projectSlug/playground',
    icon: TerminalSquareIcon,
    shortcut: 'P',
  },
  {
    titleKey: 'common:labels.auditLog',
    to: '/app/$projectSlug/audit',
    icon: HistoryIcon,
    shortcut: 'A',
  },
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
  const { t } = useTranslation(['layout', 'common'])
  const palette = useCommandPalette()
  const matchRoute = useMatchRoute()
  const isActive = (to: string) =>
    matchRoute({ to, params: { projectSlug: current.slug }, fuzzy: true }) !== false
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <ProjectSwitcher projects={projects} current={current} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t('sidebar.searchTooltip')}
                onClick={() => palette.setOpen(true)}
              >
                <SearchIcon />
                <span className="flex-1">{t('sidebar.search')}</span>
                <KbdGroup className="group-data-[collapsible=icon]:hidden">
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t('sidebar.projectGroup')}</SidebarGroupLabel>
          <SidebarMenu>
            {projectNav.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild tooltip={t(item.titleKey)} isActive={isActive(item.to)}>
                  <Link to={item.to} params={{ projectSlug: current.slug }}>
                    <item.icon />
                    <span>{t(item.titleKey)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip={t('common:labels.settings')}
                isActive={isActive('/app/$projectSlug/settings')}
              >
                <Link to="/app/$projectSlug/settings" params={{ projectSlug: current.slug }}>
                  <SettingsIcon />
                  <span>{t('common:labels.settings')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail label={t('sidebar.toggle')} />
    </Sidebar>
  )
}
