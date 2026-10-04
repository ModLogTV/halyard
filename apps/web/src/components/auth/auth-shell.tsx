import type { ReactNode } from 'react'
import { HalyardMark } from '@/components/brand'
import { LocaleSelect } from '@/components/locale-switcher'

/** Two-column layout for sign in and sign up. The left panel is the product's one marketing moment. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r bg-sidebar p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5">
          <HalyardMark className="size-7" />
          <span className="text-base font-semibold tracking-tight">Halyard</span>
        </div>
        <div className="max-w-md space-y-6">
          <FlagPreview />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Raise features gradually. Lower them instantly.
            </h1>
            <p className="mt-3 text-muted-foreground">
              Self-hosted feature flags with sticky rollouts, segments, experiments and an
              OpenFeature compatible API. Your data stays on your infrastructure.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Open source, MIT licensed.</p>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <HalyardMark className="size-7" />
            <span className="text-base font-semibold tracking-tight">Halyard</span>
          </div>
          {children}
          <div className="mt-8 flex justify-end">
            <LocaleSelect />
          </div>
        </div>
      </main>
    </div>
  )
}

/** A static rendering of a flag row across three environments, mirroring the real UI. */
function FlagPreview() {
  const rows: Array<{
    env: string
    color: string
    on: boolean
    rollout?: number
    production?: boolean
  }> = [
    { env: 'development', color: '#3b82f6', on: true },
    { env: 'staging', color: '#f59e0b', on: true, rollout: 50 },
    { env: 'production', color: '#e11d48', on: false, production: true },
  ]
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-sm">checkout.new-payment-flow</div>
          <div className="text-xs text-muted-foreground">boolean · 3 environments</div>
        </div>
        <span className="rounded-md bg-on-soft px-2 py-0.5 font-mono text-[11px] text-foreground">
          v12
        </span>
      </div>
      <ul className="mt-4 divide-y">
        {rows.map((r) => (
          <li
            key={r.env}
            className={`flex items-center justify-between py-2.5 pl-3 ${r.production ? 'hazard-stripes' : ''}`}
            style={{ ['--env-color' as string]: r.color }}
          >
            <span className="text-sm">{r.env}</span>
            <span className="flex items-center gap-3 text-xs text-muted-foreground tabular">
              {r.rollout ? <span>{r.rollout}% rollout</span> : null}
              <span
                className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${r.on ? 'bg-on' : 'bg-off'}`}
                aria-hidden="true"
              >
                <span
                  className={`size-4 rounded-full bg-white shadow transition-transform ${r.on ? 'translate-x-4' : ''}`}
                />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
