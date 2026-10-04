import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import {
  CalendarClockIcon,
  ColumnsIcon,
  FlagIcon,
  FlaskConicalIcon,
  FolderIcon,
  HistoryIcon,
  MoonIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  SettingsIcon,
  SunIcon,
  TerminalSquareIcon,
  UsersRoundIcon,
} from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { EnvironmentLike } from '@/components/env/env-badge'
import { EnvDot } from '@/components/env/env-badge'
import { FlagTypeBadge } from '@/components/flags/flag-type-badge'
import { useTheme } from '@/components/theme-provider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { listFlags, toggleFlag } from '@/server/functions/flags'
import { listSegments } from '@/server/functions/segments'

export interface PaletteProject {
  id: string
  name: string
  slug: string
  role: string
  environments: (EnvironmentLike & { id: string })[]
}

interface PaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  registerProject: (project: PaletteProject | null) => void
}

const PaletteContext = createContext<PaletteContextValue>({
  open: false,
  setOpen: () => {},
  registerProject: () => {},
})

export function useCommandPalette() {
  return useContext(PaletteContext)
}

/** Project layouts call this so the palette can search flags and segments of the current project. */
export function useRegisterPaletteProject(project: PaletteProject) {
  const { registerProject } = useContext(PaletteContext)
  useEffect(() => {
    registerProject(project)
    return () => registerProject(null)
  }, [project, registerProject])
}

interface FlagEntry {
  key: string
  name: string
  type: 'boolean' | 'string' | 'number' | 'json'
  archivedAt: Date | string | null
  environments: { environmentId: string; environmentKey: string; enabled: boolean }[]
}

/**
 * Command palette (⌘K / Ctrl+K): jump to projects, flags, segments and pages, and
 * toggle a flag per environment without leaving the current screen.
 */
export function CommandPaletteProvider({
  children,
  projects,
}: {
  children: ReactNode
  projects: { id: string; name: string; slug: string }[]
}) {
  const { t } = useTranslation(['layout', 'common'])
  const [open, setOpen] = useState(false)
  const [project, setProject] = useState<PaletteProject | null>(null)
  const [selectedFlag, setSelectedFlag] = useState<FlagEntry | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<{
    env: PaletteProject['environments'][number]
    enabled: boolean
  } | null>(null)
  const navigate = useNavigate()
  const router = useRouter()
  const { setTheme } = useTheme()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setSelectedFlag(null)
  }, [])

  const go = useCallback(
    (to: string, params?: Record<string, string>) => {
      close()
      void navigate({ to, params } as never)
    },
    [close, navigate],
  )

  const registerProject = useCallback((next: PaletteProject | null) => setProject(next), [])
  const value = useMemo(() => ({ open, setOpen, registerProject }), [open, registerProject])

  const data = useQuery({
    queryKey: ['palette', project?.id],
    enabled: open && Boolean(project),
    staleTime: 15_000,
    queryFn: async () => {
      const projectId = project!.id
      const [flags, segments] = await Promise.all([
        listFlags({ data: { projectId } }),
        listSegments({ data: { projectId } }),
      ])
      return { flags: flags as FlagEntry[], segments }
    },
  })

  const slug = project?.slug
  const canToggle = project ? project.role !== 'viewer' : false

  async function applyToggle(
    flag: FlagEntry,
    env: PaletteProject['environments'][number],
    enabled: boolean,
  ) {
    if (!project) return
    try {
      await toggleFlag({
        data: { projectId: project.id, flagKey: flag.key, environmentKey: env.key, enabled },
      })
      toast.success(
        t(enabled ? 'commandPalette.toasts.turnedOn' : 'commandPalette.toasts.turnedOff', {
          key: flag.key,
          environment: env.name,
        }),
      )
      await Promise.all([router.invalidate(), data.refetch()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('commandPalette.toasts.updateFailed'))
    }
  }

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title={t('commandPalette.title')}
        description={t('commandPalette.description')}
      >
        <Command>
          {selectedFlag && project ? (
            <>
              <CommandInput
                placeholder={t('commandPalette.flagActionsPlaceholder', { key: selectedFlag.key })}
              />
              <CommandList>
                <CommandEmpty>{t('commandPalette.noActions')}</CommandEmpty>
                <CommandGroup heading={selectedFlag.name}>
                  <CommandItem
                    onSelect={() =>
                      go('/app/$projectSlug/flags/$flagKey', {
                        projectSlug: project.slug,
                        flagKey: selectedFlag.key,
                      })
                    }
                  >
                    <FlagIcon /> {t('commandPalette.openFlag')}
                  </CommandItem>
                  {canToggle
                    ? project.environments.map((env) => {
                        const state = selectedFlag.environments.find(
                          (e) => e.environmentId === env.id,
                        )
                        if (!state) return null
                        const next = !state.enabled
                        return (
                          <CommandItem
                            key={env.id}
                            value={`toggle ${env.name} ${next ? 'on' : 'off'}`}
                            onSelect={() => {
                              if (env.isProduction) setConfirmToggle({ env, enabled: next })
                              else void applyToggle(selectedFlag, env, next)
                            }}
                          >
                            {next ? (
                              <PowerIcon className="text-on" />
                            ) : (
                              <PowerOffIcon className="text-muted-foreground" />
                            )}
                            {next ? t('commandPalette.turnOnIn') : t('commandPalette.turnOffIn')}
                            <span className="inline-flex items-center gap-1.5">
                              <EnvDot env={env} /> {env.name}
                            </span>
                            {env.isProduction ? (
                              <CommandShortcut className="font-sans normal-case">
                                {t('common:states.production')}
                              </CommandShortcut>
                            ) : null}
                          </CommandItem>
                        )
                      })
                    : null}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => setSelectedFlag(null)}>
                    {t('commandPalette.backToSearch')}
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </>
          ) : (
            <>
              <CommandInput placeholder={t('commandPalette.searchPlaceholder')} />
              <CommandList>
                <CommandEmpty>
                  {data.isLoading ? t('common:states.loading') : t('commandPalette.noResults')}
                </CommandEmpty>
                {slug && data.data && data.data.flags.length > 0 ? (
                  <CommandGroup heading={t('commandPalette.groups.flags')}>
                    {data.data.flags
                      .filter((f) => !f.archivedAt)
                      .slice(0, 50)
                      .map((flag) => (
                        <CommandItem
                          key={flag.key}
                          value={`flag ${flag.key} ${flag.name}`}
                          onSelect={() => setSelectedFlag(flag)}
                        >
                          <FlagIcon />
                          <span className="font-mono text-xs">{flag.key}</span>
                          <span className="truncate text-muted-foreground">{flag.name}</span>
                          <CommandShortcut>
                            <FlagTypeBadge type={flag.type} />
                          </CommandShortcut>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                ) : null}
                {slug && data.data && data.data.segments.length > 0 ? (
                  <CommandGroup heading={t('commandPalette.groups.segments')}>
                    {data.data.segments.slice(0, 20).map((segment) => (
                      <CommandItem
                        key={segment.key}
                        value={`segment ${segment.key} ${segment.name}`}
                        onSelect={() =>
                          go('/app/$projectSlug/segments/$segmentKey', {
                            projectSlug: slug,
                            segmentKey: segment.key,
                          })
                        }
                      >
                        <UsersRoundIcon />
                        <span className="font-mono text-xs">{segment.key}</span>
                        <span className="truncate text-muted-foreground">{segment.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
                {slug ? (
                  <CommandGroup heading={t('commandPalette.groups.goTo')}>
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/flags', { projectSlug: slug })}
                    >
                      <FlagIcon /> {t('common:labels.flags')}
                    </CommandItem>
                    {canToggle ? (
                      <CommandItem
                        onSelect={() => go('/app/$projectSlug/flags/new', { projectSlug: slug })}
                      >
                        <PlusIcon /> {t('commandPalette.items.newFlag')}
                      </CommandItem>
                    ) : null}
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/segments', { projectSlug: slug })}
                    >
                      <UsersRoundIcon /> {t('common:labels.segments')}
                    </CommandItem>
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/compare', { projectSlug: slug })}
                    >
                      <ColumnsIcon /> {t('commandPalette.items.compareEnvironments')}
                    </CommandItem>
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/experiments', { projectSlug: slug })}
                    >
                      <FlaskConicalIcon /> {t('common:labels.experiments')}
                    </CommandItem>
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/schedules', { projectSlug: slug })}
                    >
                      <CalendarClockIcon /> {t('crumbs.schedules')}
                    </CommandItem>
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/playground', { projectSlug: slug })}
                    >
                      <TerminalSquareIcon /> {t('common:labels.playground')}
                    </CommandItem>
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/audit', { projectSlug: slug })}
                    >
                      <HistoryIcon /> {t('common:labels.auditLog')}
                    </CommandItem>
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/settings', { projectSlug: slug })}
                    >
                      <SettingsIcon /> {t('common:labels.settings')}
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                <CommandGroup heading={t('commandPalette.groups.projects')}>
                  {projects.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`project ${p.name} ${p.slug}`}
                      onSelect={() => go('/app/$projectSlug', { projectSlug: p.slug })}
                    >
                      <FolderIcon /> {p.name}
                    </CommandItem>
                  ))}
                  <CommandItem onSelect={() => go('/app/new')}>
                    <PlusIcon /> {t('commandPalette.items.newProject')}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading={t('commandPalette.groups.appearance')}>
                  <CommandItem
                    onSelect={() => {
                      setTheme('light')
                      close()
                    }}
                  >
                    <SunIcon /> {t('commandPalette.items.lightTheme')}
                  </CommandItem>
                  <CommandItem
                    onSelect={() => {
                      setTheme('dark')
                      close()
                    }}
                  >
                    <MoonIcon /> {t('commandPalette.items.darkTheme')}
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </>
          )}
        </Command>
      </CommandDialog>

      <AlertDialog open={confirmToggle !== null} onOpenChange={(o) => !o && setConfirmToggle(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmToggle?.enabled
                ? t('commandPalette.confirm.enableTitle')
                : t('commandPalette.confirm.disableTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                t={t}
                i18nKey={
                  confirmToggle?.enabled
                    ? 'commandPalette.confirm.enableDescription'
                    : 'commandPalette.confirm.disableDescription'
                }
                values={{ key: selectedFlag?.key, environment: confirmToggle?.env.name }}
                components={[
                  <span key="key" className="font-mono text-foreground" />,
                  <strong key="state" />,
                ]}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = confirmToggle
                setConfirmToggle(null)
                if (pending && selectedFlag)
                  void applyToggle(selectedFlag, pending.env, pending.enabled)
              }}
            >
              {confirmToggle?.enabled
                ? t('commandPalette.confirm.enableAction')
                : t('commandPalette.confirm.disableAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PaletteContext.Provider>
  )
}
