import { Link } from '@tanstack/react-router'
import { FlagIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EnvBadge, type EnvironmentLike } from '@/components/env/env-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface SegmentUsageItem {
  flagKey: string
  flagName: string
  environmentKey: string
  ruleId: string
  ruleIndex: number
}

interface FlagGroup {
  flagKey: string
  flagName: string
  environments: { environmentKey: string; rules: number[] }[]
}

export function groupUsages(usages: SegmentUsageItem[]): FlagGroup[] {
  const groups = new Map<string, FlagGroup>()
  for (const usage of usages) {
    let group = groups.get(usage.flagKey)
    if (!group) {
      group = { flagKey: usage.flagKey, flagName: usage.flagName, environments: [] }
      groups.set(usage.flagKey, group)
    }
    let env = group.environments.find((e) => e.environmentKey === usage.environmentKey)
    if (!env) {
      env = { environmentKey: usage.environmentKey, rules: [] }
      group.environments.push(env)
    }
    if (!env.rules.includes(usage.ruleIndex)) env.rules.push(usage.ruleIndex)
  }
  return [...groups.values()]
}

/** Environments keyed by `environmentKey`; unknown keys fall back to a neutral badge. */
function resolveEnv(key: string, environments: EnvironmentLike[]): EnvironmentLike {
  return (
    environments.find((env) => env.key === key) ?? {
      key,
      name: key,
      color: 'var(--muted-foreground)',
      isProduction: false,
    }
  )
}

export function UsageList({
  usages,
  projectSlug,
  environments,
}: {
  usages: SegmentUsageItem[]
  projectSlug: string
  environments: EnvironmentLike[]
}) {
  const { t } = useTranslation('segments')
  const groups = groupUsages(usages)
  return (
    <ul className="flex flex-col divide-y">
      {groups.map((group) => (
        <li key={group.flagKey} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <FlagIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 self-center text-muted-foreground"
            />
            <Link
              to="/app/$projectSlug/flags/$flagKey"
              params={{ projectSlug, flagKey: group.flagKey }}
              className="truncate font-medium text-sm underline-offset-4 hover:underline"
            >
              {group.flagName}
            </Link>
            <span className="truncate font-mono text-muted-foreground text-xs">
              {group.flagKey}
            </span>
          </div>
          <ul className="flex flex-col gap-1.5 pl-5.5">
            {group.environments.map((env) => (
              <li key={env.environmentKey} className="flex flex-wrap items-center gap-1.5">
                <EnvBadge env={resolveEnv(env.environmentKey, environments)} />
                {env.rules
                  .slice()
                  .sort((a, b) => a - b)
                  .map((index) => (
                    <Badge key={index} variant="secondary" className="font-mono">
                      {t('usages.rule', { number: index + 1 })}
                    </Badge>
                  ))}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

export function SegmentUsagesCard({
  usages,
  projectSlug,
  environments,
}: {
  usages: SegmentUsageItem[]
  projectSlug: string
  environments: EnvironmentLike[]
}) {
  const { t } = useTranslation(['segments', 'common'])
  const flagCount = new Set(usages.map((usage) => usage.flagKey)).size
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('usages.title')}</CardTitle>
        <CardDescription>
          {usages.length === 0
            ? t('usages.empty')
            : t('usages.summary', {
                flags: t('common:counts.flags', { count: flagCount }),
                rules: t('common:counts.rules', { count: usages.length }),
              })}
        </CardDescription>
      </CardHeader>
      {usages.length > 0 ? (
        <CardContent>
          <UsageList usages={usages} projectSlug={projectSlug} environments={environments} />
        </CardContent>
      ) : null}
    </Card>
  )
}
