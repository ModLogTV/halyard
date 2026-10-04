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
      toast.success(`${flag.key} is now ${enabled ? 'on' : 'off'} in ${env.name}`)
      await Promise.all([router.invalidate(), data.refetch()])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the flag')
    }
  }

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title="Command palette"
        description="Search flags, segments and pages"
      >
        {selectedFlag && project ? (
          <>
            <CommandInput placeholder={`Actions for ${selectedFlag.key}`} />
            <CommandList>
              <CommandEmpty>No actions.</CommandEmpty>
              <CommandGroup heading={selectedFlag.name}>
                <CommandItem
                  onSelect={() =>
                    go('/app/$projectSlug/flags/$flagKey', {
                      projectSlug: project.slug,
                      flagKey: selectedFlag.key,
                    })
                  }
                >
                  <FlagIcon /> Open flag
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
                          Turn {next ? 'on' : 'off'} in
                          <span className="inline-flex items-center gap-1.5">
                            <EnvDot env={env} /> {env.name}
                          </span>
                          {env.isProduction ? (
                            <CommandShortcut className="font-sans normal-case">
                              production
                            </CommandShortcut>
                          ) : null}
                        </CommandItem>
                      )
                    })
                  : null}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem onSelect={() => setSelectedFlag(null)}>Back to search</CommandItem>
              </CommandGroup>
            </CommandList>
          </>
        ) : (
          <>
            <CommandInput placeholder="Type a flag key, segment, page or command…" />
            <CommandList>
              <CommandEmpty>{data.isLoading ? 'Loading…' : 'No results found.'}</CommandEmpty>
              {slug && data.data && data.data.flags.length > 0 ? (
                <CommandGroup heading="Flags">
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
                <CommandGroup heading="Segments">
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
                <CommandGroup heading="Go to">
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/flags', { projectSlug: slug })}
                  >
                    <FlagIcon /> Flags
                  </CommandItem>
                  {canToggle ? (
                    <CommandItem
                      onSelect={() => go('/app/$projectSlug/flags/new', { projectSlug: slug })}
                    >
                      <PlusIcon /> New flag
                    </CommandItem>
                  ) : null}
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/segments', { projectSlug: slug })}
                  >
                    <UsersRoundIcon /> Segments
                  </CommandItem>
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/compare', { projectSlug: slug })}
                  >
                    <ColumnsIcon /> Compare environments
                  </CommandItem>
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/experiments', { projectSlug: slug })}
                  >
                    <FlaskConicalIcon /> Experiments
                  </CommandItem>
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/schedules', { projectSlug: slug })}
                  >
                    <CalendarClockIcon /> Scheduled changes
                  </CommandItem>
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/playground', { projectSlug: slug })}
                  >
                    <TerminalSquareIcon /> Playground
                  </CommandItem>
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/audit', { projectSlug: slug })}
                  >
                    <HistoryIcon /> Audit log
                  </CommandItem>
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/settings', { projectSlug: slug })}
                  >
                    <SettingsIcon /> Settings
                  </CommandItem>
                </CommandGroup>
              ) : null}
              <CommandGroup heading="Projects">
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
                  <PlusIcon /> New project
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Appearance">
                <CommandItem
                  onSelect={() => {
                    setTheme('light')
                    close()
                  }}
                >
                  <SunIcon /> Light theme
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    setTheme('dark')
                    close()
                  }}
                >
                  <MoonIcon /> Dark theme
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </>
        )}
      </CommandDialog>

      <AlertDialog open={confirmToggle !== null} onOpenChange={(o) => !o && setConfirmToggle(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmToggle?.enabled ? 'Enable' : 'Disable'} in production?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono text-foreground">{selectedFlag?.key}</span> will be turned{' '}
              <strong>{confirmToggle?.enabled ? 'on' : 'off'}</strong> for everyone in{' '}
              {confirmToggle?.env.name} immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = confirmToggle
                setConfirmToggle(null)
                if (pending && selectedFlag)
                  void applyToggle(selectedFlag, pending.env, pending.enabled)
              }}
            >
              {confirmToggle?.enabled ? 'Enable in production' : 'Disable in production'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PaletteContext.Provider>
  )
}
