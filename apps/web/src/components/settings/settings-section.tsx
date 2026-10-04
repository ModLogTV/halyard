import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** A titled block of a settings page with an optional action on the right. */
export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Route `pendingComponent` for settings pages. */
export function SettingsPending({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col gap-3"
      role="status"
      aria-busy="true"
      aria-label={t('a11y.loading')}
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-72" />
      <div className="mt-2 grid gap-2">
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}
