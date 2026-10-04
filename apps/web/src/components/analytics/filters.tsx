import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EnvDot, type EnvironmentLike } from '@/components/env/env-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ANALYTICS_RANGES, type AnalyticsRange } from '@/server/schemas/analytics'

const ALL = '__all__'

export interface AnalyticsFiltersProps {
  range: AnalyticsRange
  onRangeChange: (range: AnalyticsRange) => void
  environments: EnvironmentLike[]
  /** Selected environment key; all environments when undefined. */
  environmentKey: string | undefined
  onEnvironmentChange: (key: string | undefined) => void
  /** Shown at the end of the row, for example a refresh indicator. */
  children?: ReactNode
}

/** The one filter row above the analytics charts: time range and environment. */
export function AnalyticsFilters({
  range,
  onRangeChange,
  environments,
  environmentKey,
  onEnvironmentChange,
  children,
}: AnalyticsFiltersProps) {
  const { t } = useTranslation('analytics')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={range}
        onValueChange={(value) => {
          if (value) onRangeChange(value as AnalyticsRange)
        }}
        aria-label={t('filters.range')}
      >
        {ANALYTICS_RANGES.map((value) => (
          <ToggleGroupItem key={value} value={value} className="px-3">
            {t(`filters.ranges.${value}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select
        value={environmentKey ?? ALL}
        onValueChange={(value) => onEnvironmentChange(value === ALL ? undefined : value)}
      >
        <SelectTrigger size="sm" className="min-w-44" aria-label={t('filters.environment')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('filters.allEnvironments')}</SelectItem>
          {environments.map((env) => (
            <SelectItem key={env.key} value={env.key}>
              <EnvDot env={env} />
              {env.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
    </div>
  )
}
