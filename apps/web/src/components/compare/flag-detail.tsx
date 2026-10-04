import type { Serve, Variant } from '@halyard/engine'
import { ArrowRightIcon, RotateCwIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { JsonDiff } from '@/components/audit'
import { EnvBadge, envStyle } from '@/components/env/env-badge'
import { RolloutBar, VariantValue } from '@/components/flags'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getFlag } from '@/server/functions/flags'
import { type CompareEnvironment, diffable, type EnvConfig, variantIndexOf } from './utils'

export type FlagDetailData = Awaited<ReturnType<typeof getFlag>>

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FlagDetailData }

function useFlagDetail(projectId: string, flagKey: string) {
  const { t } = useTranslation('compare')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` retriggers the load
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    getFlag({ data: { projectId, flagKey } })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : t('detail.loadFailed'),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, flagKey, attempt, t])

  return { state, retry: useCallback(() => setAttempt((n) => n + 1), []) }
}

export function configOf(
  detail: FlagDetailData,
  environment: Pick<CompareEnvironment, 'id'>,
): (EnvConfig & { version: number; updatedAt: Date | string }) | undefined {
  return detail.environments.find((e) => e.environmentId === environment.id)
}

function ServeView({
  serve,
  variants,
  type,
}: {
  serve: Serve
  variants: Variant[]
  type: FlagDetailData['type']
}) {
  const { t } = useTranslation('compare')
  if (serve.type === 'variant') {
    const index = variantIndexOf(variants, serve.variant)
    const variant = variants[index]
    return (
      <VariantValue
        value={variant?.value ?? null}
        type={type}
        variantKey={serve.variant}
        index={index}
      />
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <RolloutBar
        variations={serve.variations}
        variants={variants}
        type={type}
        height={16}
        showLabels
      />
      {serve.bucketBy ? (
        <span className="text-[11px] text-muted-foreground">
          <Trans
            t={t}
            i18nKey="detail.bucketedBy"
            values={{ key: serve.bucketBy }}
            components={[<span key="key" className="font-mono" />]}
          />
        </span>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

function EnvColumn({
  environment,
  config,
  baselineConfig,
  isBaseline,
  detail,
  action,
}: {
  environment: CompareEnvironment
  config: ReturnType<typeof configOf>
  baselineConfig: ReturnType<typeof configOf>
  isBaseline: boolean
  detail: FlagDetailData
  action?: React.ReactNode
}) {
  const { t, i18n } = useTranslation(['compare', 'common'])
  return (
    <section
      aria-label={t('detail.environmentConfiguration', { environment: environment.name })}
      style={envStyle(environment)}
      className={cn(
        'flex min-w-64 flex-1 flex-col gap-4 rounded-lg border bg-card p-3',
        environment.isProduction && 'hazard-stripes',
      )}
    >
      <div className="flex items-center gap-2">
        <EnvBadge env={environment} />
        {isBaseline ? <Badge variant="secondary">{t('detail.baseline')}</Badge> : null}
        <span className="ml-auto">{action}</span>
      </div>
      {!config ? (
        <p className="text-sm text-muted-foreground">{t('detail.notConfigured')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common:labels.status')}>
              <span className="inline-flex items-center gap-1.5 text-sm">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 rounded-full',
                    config.enabled ? 'bg-on' : 'bg-muted-foreground/40',
                  )}
                />
                {config.enabled ? t('detail.statusOn') : t('detail.statusOff')}
              </span>
            </Field>
            <Field label={t('copyFields.offVariant.label')}>
              <ServeView
                serve={{ type: 'variant', variant: config.offVariant }}
                variants={detail.variants}
                type={detail.type}
              />
            </Field>
          </div>
          <Field label={t('copyFields.fallthrough.label')}>
            <ServeView serve={config.fallthrough} variants={detail.variants} type={detail.type} />
          </Field>
          <Field label={t('detail.rulesCount', { count: config.rules.length })}>
            {config.rules.length === 0 ? (
              <span className="text-sm text-muted-foreground">{t('detail.noRules')}</span>
            ) : (
              <ol className="flex flex-col gap-2">
                {config.rules.map((rule, index) => (
                  <li
                    key={rule.id}
                    className="flex flex-col gap-1.5 rounded-md border bg-background p-2"
                  >
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="tabular font-mono text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 truncate',
                          !rule.description && 'text-muted-foreground',
                        )}
                      >
                        {rule.description || t('detail.untitledRule')}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {t('detail.conditions', { count: rule.conditions.length })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
                      <ServeView serve={rule.serve} variants={detail.variants} type={detail.type} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Field>
          <p className="tabular text-xs text-muted-foreground">
            {t('detail.versionLine', {
              version: config.version,
              time: formatRelativeTime(config.updatedAt, { locale: i18n.language }),
            })}
          </p>
          {!isBaseline && baselineConfig ? (
            <Field label={t('detail.differsFromBaseline')}>
              <JsonDiff before={diffable(baselineConfig)} after={diffable(config)} />
            </Field>
          ) : null}
        </>
      )}
    </section>
  )
}

/**
 * Side by side configuration of one flag across environments. Loads the flag when mounted.
 * The raw diff goes from the baseline to each other environment.
 */
export function FlagDetail({
  projectId,
  flagKey,
  environments,
  baseline,
  renderAction,
}: {
  projectId: string
  flagKey: string
  environments: CompareEnvironment[]
  baseline: CompareEnvironment
  renderAction?: (environment: CompareEnvironment) => React.ReactNode
}) {
  const { t } = useTranslation(['compare', 'common'])
  const { state, retry } = useFlagDetail(projectId, flagKey)

  if (state.status === 'loading') {
    return (
      <div className="flex gap-3 p-4" aria-busy="true">
        {environments.map((e) => (
          <Skeleton key={e.id} className="h-56 min-w-64 flex-1" />
        ))}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-3 p-4 text-sm">
        <span className="text-destructive">{state.message}</span>
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          <RotateCwIcon /> {t('common:actions.retry')}
        </Button>
      </div>
    )
  }
  const baselineConfig = configOf(state.data, baseline)
  return (
    <div className="flex gap-3 overflow-x-auto p-4">
      {environments.map((environment) => (
        <EnvColumn
          key={environment.id}
          environment={environment}
          config={configOf(state.data, environment)}
          baselineConfig={baselineConfig}
          isBaseline={environment.id === baseline.id}
          detail={state.data}
          action={environment.id === baseline.id ? undefined : renderAction?.(environment)}
        />
      ))}
    </div>
  )
}
