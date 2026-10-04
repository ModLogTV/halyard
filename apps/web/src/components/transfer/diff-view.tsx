import type { JsonValue } from '@halyard/engine'
import { ChevronsUpDownIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { JsonDiff } from '@/components/audit'
import { EnvBadge, type EnvironmentLike } from '@/components/env/env-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'
import { pluralize } from '@/lib/format'
import type {
  EntityDiff,
  EntityRef,
  EntityUpdate,
  FieldChange,
  FlagUpdate,
  ImportChanges,
} from '@/server/transfer/diff'
import type { ExportEnvironment, ExportFlag, ExportSegment } from '@/server/transfer/format'

const fieldsToJson = (changes: FieldChange[], side: 'before' | 'after'): JsonValue =>
  Object.fromEntries(changes.map((change) => [change.field, change[side]]))

function Counts({ diff }: { diff: EntityDiff<unknown, unknown> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {diff.create.length > 0 ? <Badge>{diff.create.length} created</Badge> : null}
      {diff.update.length > 0 ? (
        <Badge variant="secondary">{diff.update.length} updated</Badge>
      ) : null}
      {diff.delete.length > 0 ? (
        <Badge variant="destructive">{diff.delete.length} deleted</Badge>
      ) : null}
      <Badge variant="outline">{diff.unchanged} unchanged</Badge>
    </div>
  )
}

type Kind = 'created' | 'updated' | 'deleted'

const KIND_BADGE: Record<
  Kind,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  created: { label: 'Created', variant: 'default' },
  updated: { label: 'Updated', variant: 'secondary' },
  deleted: { label: 'Deleted', variant: 'destructive' },
}

/** One entity of the diff; rows with details expand to show them. */
function ChangeRow({
  kind,
  entityKey,
  name,
  summary,
  children,
}: {
  kind: Kind
  entityKey: string
  name: string
  summary?: string
  children?: ReactNode
}) {
  const badge = KIND_BADGE[kind]
  const row = (
    <Item variant="outline" size="sm">
      <ItemContent>
        <ItemTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span className="font-mono">{entityKey}</span>
        </ItemTitle>
        {name !== entityKey || summary ? (
          <ItemDescription>
            {[name !== entityKey ? name : null, summary].filter(Boolean).join(' · ')}
          </ItemDescription>
        ) : null}
      </ItemContent>
      {children ? (
        <ItemActions>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="group/trigger">
              Details <ChevronsUpDownIcon />
              <span className="sr-only">for {entityKey}</span>
            </Button>
          </CollapsibleTrigger>
        </ItemActions>
      ) : null}
    </Item>
  )
  if (!children) return row
  return (
    <Collapsible>
      {row}
      <CollapsibleContent className="mt-2 mb-1 flex flex-col gap-3 pl-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function Section({
  title,
  diff,
  children,
}: {
  title: string
  diff: EntityDiff<unknown, unknown>
  children: ReactNode
}) {
  const changed = diff.create.length + diff.update.length + diff.delete.length
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Counts diff={diff} />
      </div>
      {changed > 0 ? <ItemGroup className="gap-2">{children}</ItemGroup> : null}
    </section>
  )
}

function UpdateDetails({
  update,
  environments,
}: {
  update: EntityUpdate | FlagUpdate
  environments: EnvironmentLike[]
}) {
  const envChanges = 'environments' in update ? update.environments : []
  return (
    <>
      {update.changes.length > 0 ? (
        <JsonDiff
          before={fieldsToJson(update.changes, 'before')}
          after={fieldsToJson(update.changes, 'after')}
        />
      ) : null}
      {envChanges.map((change) => {
        const env = environments.find((e) => e.key === change.environmentKey)
        return (
          <div key={change.environmentKey} className="flex flex-col gap-1.5">
            {env ? (
              <EnvBadge env={env} />
            ) : (
              <Badge variant="outline" className="font-mono">
                {change.environmentKey}
              </Badge>
            )}
            <JsonDiff
              before={fieldsToJson(change.changes, 'before')}
              after={fieldsToJson(change.changes, 'after')}
            />
          </div>
        )
      })}
    </>
  )
}

function Deleted({ refs }: { refs: EntityRef[] }) {
  return refs.map((ref) => (
    <ChangeRow key={`deleted-${ref.key}`} kind="deleted" entityKey={ref.key} name={ref.name} />
  ))
}

function updatesOf<U extends EntityUpdate>(updates: U[], environments: EnvironmentLike[]) {
  return updates.map((update) => (
    <ChangeRow
      key={`updated-${update.key}`}
      kind="updated"
      entityKey={update.key}
      name={update.name}
      summary={summaryOf(update)}
    >
      <UpdateDetails update={update} environments={environments} />
    </ChangeRow>
  ))
}

function summaryOf(update: EntityUpdate | FlagUpdate): string {
  const envs = 'environments' in update ? update.environments.length : 0
  const parts = []
  if (update.changes.length > 0) parts.push(update.changes.map((c) => c.field).join(', '))
  if (envs > 0) parts.push(pluralize(envs, 'environment config'))
  return parts.join(' · ')
}

/** The changes of an import grouped by environments, segments and flags. */
export function DiffView({
  diff,
  environments,
}: {
  diff: ImportChanges
  environments: EnvironmentLike[]
}) {
  // Environments created by the import are not in the project yet.
  const known: EnvironmentLike[] = [
    ...environments,
    ...diff.environments.create.filter((e) => !environments.some((x) => x.key === e.key)),
  ]
  return (
    <div className="flex flex-col gap-6">
      <Section title="Environments" diff={diff.environments}>
        {diff.environments.create.map((env: ExportEnvironment) => (
          <ChangeRow
            key={`created-${env.key}`}
            kind="created"
            entityKey={env.key}
            name={env.name}
            summary={env.isProduction ? 'production' : undefined}
          />
        ))}
        {updatesOf(diff.environments.update, known)}
        <Deleted refs={diff.environments.delete} />
      </Section>
      <Section title="Segments" diff={diff.segments}>
        {diff.segments.create.map((segment: ExportSegment) => (
          <ChangeRow
            key={`created-${segment.key}`}
            kind="created"
            entityKey={segment.key}
            name={segment.name}
            summary={pluralize(segment.conditions.length, 'condition')}
          >
            <JsonDiff before={null} after={segment as unknown as JsonValue} />
          </ChangeRow>
        ))}
        {updatesOf(diff.segments.update, known)}
        <Deleted refs={diff.segments.delete} />
      </Section>
      <Section title="Flags" diff={diff.flags}>
        {diff.flags.create.map((flag: ExportFlag) => (
          <ChangeRow
            key={`created-${flag.key}`}
            kind="created"
            entityKey={flag.key}
            name={flag.name}
            summary={`${flag.type}, ${pluralize(flag.variants.length, 'variant')}`}
          >
            <JsonDiff before={null} after={flag as unknown as JsonValue} />
          </ChangeRow>
        ))}
        {updatesOf(diff.flags.update, known)}
        <Deleted refs={diff.flags.delete} />
      </Section>
    </div>
  )
}

/** Production environments the import changes, for the extra confirmation. */
export function productionImpact(
  diff: ImportChanges,
  environments: EnvironmentLike[],
): { environments: EnvironmentLike[]; configChanges: number; deletions: number } {
  const production = [
    ...environments,
    ...diff.environments.create.filter((e) => !environments.some((x) => x.key === e.key)),
  ].filter((env) => env.isProduction)
  const keys = new Set(production.map((env) => env.key))
  const touched = new Set<string>()
  let configChanges = 0

  for (const update of diff.flags.update) {
    for (const change of update.environments) {
      if (!keys.has(change.environmentKey)) continue
      configChanges += 1
      touched.add(change.environmentKey)
    }
  }
  for (const flag of diff.flags.create) {
    for (const key of Object.keys(flag.environments)) {
      if (!keys.has(key)) continue
      configChanges += 1
      touched.add(key)
    }
  }
  for (const update of diff.environments.update) if (keys.has(update.key)) touched.add(update.key)
  const deletions =
    diff.flags.delete.length +
    diff.segments.delete.length +
    diff.environments.delete.filter((e) => keys.has(e.key)).length
  if (diff.flags.delete.length > 0 || diff.segments.delete.length > 0) {
    for (const key of keys) touched.add(key)
  }
  for (const ref of diff.environments.delete) if (keys.has(ref.key)) touched.add(ref.key)

  return {
    environments: production.filter((env) => touched.has(env.key)),
    configChanges,
    deletions,
  }
}
