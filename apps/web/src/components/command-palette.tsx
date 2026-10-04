import { useNavigate } from '@tanstack/react-router'
import {
  CalendarClockIcon,
  ColumnsIcon,
  FlagIcon,
  FlaskConicalIcon,
  FolderIcon,
  HistoryIcon,
  MoonIcon,
  PlusIcon,
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
import { useTheme } from '@/components/theme-provider'
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

interface PaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const PaletteContext = createContext<PaletteContextValue>({ open: false, setOpen: () => {} })

export function useCommandPalette() {
  return useContext(PaletteContext)
}

export interface PaletteProject {
  id: string
  name: string
  slug: string
}

export interface PaletteFlag {
  key: string
  name: string
  type: string
}

export interface PaletteSegment {
  key: string
  name: string
}

/**
 * Command palette (⌘K / Ctrl+K). Navigation entries are always available;
 * project specific entries (flags, segments) are supplied by the project layout.
 */
export function CommandPaletteProvider({
  children,
  projects,
  currentProject,
  flags = [],
  segments = [],
  renderFlagActions,
}: {
  children: ReactNode
  projects: PaletteProject[]
  currentProject?: PaletteProject
  flags?: PaletteFlag[]
  segments?: PaletteSegment[]
  /** Renders quick actions (e.g. toggles per environment) for a selected flag. */
  renderFlagActions?: (flag: PaletteFlag, close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [selectedFlag, setSelectedFlag] = useState<PaletteFlag | null>(null)
  const navigate = useNavigate()
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

  const value = useMemo(() => ({ open, setOpen }), [open])

  const slug = currentProject?.slug

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title="Command palette"
        description="Search flags, segments and pages"
      >
        {selectedFlag && renderFlagActions ? (
          <>
            <CommandInput placeholder={`Actions for ${selectedFlag.key}`} />
            <CommandList>
              <CommandEmpty>No actions.</CommandEmpty>
              <CommandGroup heading={selectedFlag.name}>
                {renderFlagActions(selectedFlag, close)}
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
              <CommandEmpty>No results found.</CommandEmpty>
              {slug && flags.length > 0 ? (
                <CommandGroup heading="Flags">
                  {flags.slice(0, 50).map((flag) => (
                    <CommandItem
                      key={flag.key}
                      value={`flag ${flag.key} ${flag.name}`}
                      onSelect={() => {
                        if (renderFlagActions) setSelectedFlag(flag)
                        else
                          go('/app/$projectSlug/flags/$flagKey', {
                            projectSlug: slug,
                            flagKey: flag.key,
                          })
                      }}
                    >
                      <FlagIcon />
                      <span className="font-mono text-xs">{flag.key}</span>
                      <span className="truncate text-muted-foreground">{flag.name}</span>
                      <CommandShortcut className="font-sans normal-case">
                        {flag.type}
                      </CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {slug && segments.length > 0 ? (
                <CommandGroup heading="Segments">
                  {segments.slice(0, 20).map((segment) => (
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
                  <CommandItem
                    onSelect={() => go('/app/$projectSlug/flags/new', { projectSlug: slug })}
                  >
                    <PlusIcon /> New flag
                  </CommandItem>
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
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`project ${project.name} ${project.slug}`}
                    onSelect={() => go('/app/$projectSlug', { projectSlug: project.slug })}
                  >
                    <FolderIcon /> {project.name}
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
    </PaletteContext.Provider>
  )
}
