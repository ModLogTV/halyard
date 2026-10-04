import { TriangleAlertIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface EnvironmentLike {
  key: string
  name: string
  color: string
  isProduction: boolean
}

/** Sets `--env-color` so children can use `bg-env`, `text-env`, `env-rail` and `hazard-stripes`. */
export function envStyle(env: Pick<EnvironmentLike, 'color'>): CSSProperties {
  return { ['--env-color' as string]: env.color }
}

export function EnvDot({
  env,
  className,
}: {
  env: Pick<EnvironmentLike, 'color' | 'name'>
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: env.color }}
    />
  )
}

/** Compact environment label. Production environments carry the hazard stripe. */
export function EnvBadge({ env, className }: { env: EnvironmentLike; className?: string }) {
  return (
    <Badge
      variant="outline"
      style={envStyle(env)}
      className={cn(
        'gap-1.5 border-(--env-color)/40 bg-(--env-color)/8 font-medium text-foreground',
        env.isProduction && 'hazard-stripes',
        className,
      )}
    >
      <EnvDot env={env} />
      {env.name}
      {env.isProduction ? (
        <TriangleAlertIcon className="size-3 opacity-70" aria-label="Production" />
      ) : null}
    </Badge>
  )
}
