import { isDeepStrictEqual } from 'node:util'
import {
  type JsonValue,
  validateEnvironmentConfig,
  validateFlagDefinition,
  validateSegment,
} from '@modlogtv/halyard-engine'
import {
  defaultEnvironmentConfig,
  findVariantReferences,
  type StoredEnvironmentConfig,
} from '@/server/services/flag-config'
import type {
  ExportDocument,
  ExportEnvironment,
  ExportFlag,
  ExportFlagEnvironment,
  ExportSegment,
} from './format'

export interface FieldChange {
  field: string
  before: JsonValue
  after: JsonValue
}

const asJson = (value: unknown): JsonValue => (value === undefined ? null : (value as JsonValue))

export interface EnvironmentConfigChange {
  environmentKey: string
  changes: FieldChange[]
}

export interface EntityRef {
  key: string
  name: string
}

export interface EntityUpdate {
  key: string
  name: string
  changes: FieldChange[]
}

export interface FlagUpdate extends EntityUpdate {
  /** Per-environment configuration changes. */
  environments: EnvironmentConfigChange[]
}

export interface EntityDiff<Created, Updated> {
  create: Created[]
  update: Updated[]
  unchanged: number
  /** Entities missing from the incoming document. Only filled when pruning. */
  delete: EntityRef[]
}

export interface ImportChanges {
  environments: EntityDiff<ExportEnvironment, EntityUpdate>
  segments: EntityDiff<ExportSegment, EntityUpdate>
  flags: EntityDiff<ExportFlag, FlagUpdate>
}

export interface ImportDiff extends ImportChanges {
  /** Things that are skipped or approximated but do not block the import. */
  warnings: string[]
  /** Problems that block the import. Entities with a problem are left out of the diff. */
  errors: string[]
}

export interface DiffOptions {
  prune: boolean
}

type RuleList = ExportFlagEnvironment['rules']

const withoutIds = (rules: RuleList) => rules.map(({ id: _id, ...rest }) => rest)

/** Rules compare by value; ids are ignored. */
export const sameRules = (a: RuleList, b: RuleList) =>
  isDeepStrictEqual(withoutIds(a), withoutIds(b))

const CONFIG_FIELDS = ['enabled', 'offVariant', 'fallthrough', 'rules'] as const

/** Field-level changes between two environment configurations; empty when they are equal. */
export function diffConfig(
  before: StoredEnvironmentConfig,
  after: StoredEnvironmentConfig,
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of CONFIG_FIELDS) {
    const equal =
      field === 'rules'
        ? sameRules(before.rules, after.rules)
        : isDeepStrictEqual(before[field], after[field])
    if (!equal) {
      changes.push({ field, before: asJson(before[field]), after: asJson(after[field]) })
    }
  }
  return changes
}

function diffFields<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const field of fields) {
    if (!isDeepStrictEqual(before[field], after[field])) {
      changes.push({ field, before: asJson(before[field]), after: asJson(after[field]) })
    }
  }
  return changes
}

const ENVIRONMENT_FIELDS = ['name', 'color', 'isProduction', 'sortOrder'] as const
const SEGMENT_FIELDS = ['name', 'description', 'match', 'conditions'] as const
const FLAG_FIELDS = ['name', 'description', 'type', 'variants', 'tags', 'archived'] as const

const emptyDiff = <C, U>(): EntityDiff<C, U> => ({
  create: [],
  update: [],
  unchanged: 0,
  delete: [],
})

export function emptyImportChanges(): ImportChanges {
  return { environments: emptyDiff(), segments: emptyDiff(), flags: emptyDiff() }
}

/** Number of creates, updates and deletes in an entity diff. */
export const countChanges = (diff: EntityDiff<unknown, unknown>) =>
  diff.create.length + diff.update.length + diff.delete.length

export const hasChanges = (diff: ImportChanges) =>
  countChanges(diff.environments) + countChanges(diff.segments) + countChanges(diff.flags) > 0

function findDuplicates(label: string, keys: string[]): string[] {
  const seen = new Set<string>()
  const reported = new Set<string>()
  const errors: string[] = []
  for (const key of keys) {
    if (seen.has(key) && !reported.has(key)) {
      errors.push(`${label} "${key}" appears more than once in the document`)
      reported.add(key)
    }
    seen.add(key)
  }
  return errors
}

function defaultConfigFor(flag: ExportFlag): StoredEnvironmentConfig | null {
  try {
    return defaultEnvironmentConfig({ type: flag.type, variants: flag.variants })
  } catch {
    return null
  }
}

/**
 * Compares the project's current state with an incoming document. Pure.
 *
 * Entities are matched by key. Nothing is deleted unless `options.prune` is set. Entities
 * with problems are reported in `errors` and left out of the diff; configurations for
 * environments that the document does not define are skipped with a warning.
 */
export function diffImport(
  current: ExportDocument,
  incoming: ExportDocument,
  options: DiffOptions,
): ImportDiff {
  const diff: ImportDiff = { ...emptyImportChanges(), warnings: [], errors: [] }
  const { errors, warnings } = diff

  errors.push(
    ...findDuplicates(
      'Environment',
      incoming.environments.map((e) => e.key),
    ),
    ...findDuplicates(
      'Segment',
      incoming.segments.map((s) => s.key),
    ),
    ...findDuplicates(
      'Flag',
      incoming.flags.map((f) => f.key),
    ),
  )

  // Environments ---------------------------------------------------------------
  const currentEnvs = new Map(current.environments.map((e) => [e.key, e]))
  const incomingEnvKeys = new Set(incoming.environments.map((e) => e.key))
  const seenEnvs = new Set<string>()
  for (const env of incoming.environments) {
    if (seenEnvs.has(env.key)) continue
    seenEnvs.add(env.key)
    const existing = currentEnvs.get(env.key)
    if (!existing) {
      diff.environments.create.push(env)
      continue
    }
    const changes = diffFields(existing, env, ENVIRONMENT_FIELDS)
    if (changes.length === 0) diff.environments.unchanged += 1
    else diff.environments.update.push({ key: env.key, name: env.name, changes })
  }
  if (options.prune) {
    for (const env of current.environments) {
      if (!incomingEnvKeys.has(env.key))
        diff.environments.delete.push({ key: env.key, name: env.name })
    }
    if (incomingEnvKeys.size === 0) {
      errors.push('The import would delete every environment; a project needs at least one')
    }
  }

  // Segments -------------------------------------------------------------------
  const currentSegments = new Map(current.segments.map((s) => [s.key, s]))
  const incomingSegmentKeys = new Set(incoming.segments.map((s) => s.key))
  const finalSegmentKeys = new Set(incomingSegmentKeys)
  if (!options.prune) for (const key of currentSegments.keys()) finalSegmentKeys.add(key)

  const seenSegments = new Set<string>()
  for (const segment of incoming.segments) {
    if (seenSegments.has(segment.key)) continue
    seenSegments.add(segment.key)
    const problems = validateSegment({
      key: segment.key,
      match: segment.match,
      conditions: segment.conditions,
    })
    if (problems.length > 0) {
      errors.push(...problems.map((p) => `Segment "${segment.key}": ${p}`))
      continue
    }
    const existing = currentSegments.get(segment.key)
    if (!existing) {
      diff.segments.create.push(segment)
      continue
    }
    const changes = diffFields(existing, segment, SEGMENT_FIELDS)
    if (changes.length === 0) diff.segments.unchanged += 1
    else diff.segments.update.push({ key: segment.key, name: segment.name, changes })
  }
  if (options.prune) {
    for (const segment of current.segments) {
      if (!incomingSegmentKeys.has(segment.key)) {
        diff.segments.delete.push({ key: segment.key, name: segment.name })
      }
    }
  }

  // Flags ----------------------------------------------------------------------
  const currentFlags = new Map(current.flags.map((f) => [f.key, f]))
  const incomingFlagKeys = new Set(incoming.flags.map((f) => f.key))
  const missingEnvironments = new Map<string, string[]>()
  const seenFlags = new Set<string>()

  for (const flag of incoming.flags) {
    if (seenFlags.has(flag.key)) continue
    seenFlags.add(flag.key)
    const label = `Flag "${flag.key}"`
    const flagErrors: string[] = []

    const definitionProblems = validateFlagDefinition({
      key: flag.key,
      type: flag.type,
      variants: flag.variants,
    })
    flagErrors.push(...definitionProblems.map((p) => `${label}: ${p}`))

    // Only configurations of environments the document defines are applied.
    const configs: Record<string, ExportFlagEnvironment> = {}
    for (const [envKey, config] of Object.entries(flag.environments)) {
      if (!incomingEnvKeys.has(envKey)) {
        const list = missingEnvironments.get(envKey) ?? []
        list.push(flag.key)
        missingEnvironments.set(envKey, list)
        continue
      }
      configs[envKey] = config
      if (definitionProblems.length === 0) {
        const problems = validateEnvironmentConfig(
          { key: flag.key, type: flag.type, variants: flag.variants },
          config,
          finalSegmentKeys,
        )
        flagErrors.push(...problems.map((p) => `${label}, environment "${envKey}": ${p}`))
      }
    }

    const existing = currentFlags.get(flag.key)
    if (existing && existing.type !== flag.type) {
      flagErrors.push(
        `${label}: the type cannot change (${existing.type} to ${flag.type}); delete the flag first or use a new key`,
      )
    }

    // Variants that disappear must not be referenced by configurations the import leaves alone.
    if (existing && definitionProblems.length === 0) {
      const kept = new Set(flag.variants.map((v) => v.key))
      const removed = existing.variants.map((v) => v.key).filter((key) => !kept.has(key))
      if (removed.length > 0) {
        for (const [envKey, config] of Object.entries(existing.environments)) {
          if (envKey in configs) continue
          if (options.prune && !incomingEnvKeys.has(envKey)) continue
          for (const variantKey of removed) {
            for (const ref of findVariantReferences(config, variantKey)) {
              flagErrors.push(
                `${label}: variant "${variantKey}" is removed but still used by ${ref.where} in environment "${envKey}", which the document does not configure`,
              )
            }
          }
        }
      }
    }

    if (flagErrors.length > 0) {
      errors.push(...flagErrors)
      continue
    }

    const normalized: ExportFlag = { ...flag, environments: configs }

    if (!existing) {
      for (const envKey of incomingEnvKeys) {
        if (!(envKey in configs)) {
          warnings.push(
            `${label} has no configuration for environment "${envKey}"; it is created disabled with default targeting there`,
          )
        }
      }
      diff.flags.create.push(normalized)
      continue
    }

    const changes = diffFields(existing, flag, FLAG_FIELDS)
    const envChanges: EnvironmentConfigChange[] = []
    for (const [envKey, config] of Object.entries(configs)) {
      const before = existing.environments[envKey] ?? defaultConfigFor(flag)
      if (!before) continue
      const fieldChanges = diffConfig(before, config)
      if (fieldChanges.length > 0)
        envChanges.push({ environmentKey: envKey, changes: fieldChanges })
    }
    if (changes.length === 0 && envChanges.length === 0) diff.flags.unchanged += 1
    else
      diff.flags.update.push({ key: flag.key, name: flag.name, changes, environments: envChanges })
  }

  if (options.prune) {
    for (const flag of current.flags) {
      if (!incomingFlagKeys.has(flag.key))
        diff.flags.delete.push({ key: flag.key, name: flag.name })
    }
  }

  for (const [envKey, flagKeys] of missingEnvironments) {
    const unique = [...new Set(flagKeys)]
    const sample = unique.slice(0, 3).join(', ')
    warnings.push(
      `Environment "${envKey}" is not defined in the document; its configuration is skipped for ${unique.length} ${unique.length === 1 ? 'flag' : 'flags'} (${sample}${unique.length > 3 ? ', ...' : ''})`,
    )
  }

  return diff
}
