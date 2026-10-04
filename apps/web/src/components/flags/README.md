# Flag editing components

Controlled, server-agnostic components for editing flags. Import from `@/components/flags`.
Data types come from `@modlogtv/halyard-engine`. Nothing here calls the server; the parent owns state
and persistence. Components that use tooltips bring their own `TooltipProvider`.

Shared shapes: `SegmentOption = { key: string; name: string }`, and `EnvironmentLike` from
`@/components/env/env-badge` (`{ key, name, color, isProduction }`).

## TargetingEditor

Whole per-environment editor: status switch, off variant, ordered rules, fallthrough.

| Prop | Type | Notes |
| --- | --- | --- |
| `flag` | `FlagDefinition` | |
| `value` | `FlagEnvironmentConfig` | controlled |
| `onChange` | `(value: FlagEnvironmentConfig) => void` | |
| `segments` | `SegmentOption[]` | |
| `environment` | `EnvironmentLike` | sets `--env-color`; production gets hazard stripes |
| `attributeSuggestions?` | `string[]` | `targetingKey` is always offered |
| `disabled?` | `boolean` | read-only mode |
| `onToggleRequest?` | `(enabled: boolean) => void` | intercept the status switch (e.g. production confirm). Without it the switch calls `onChange` |

`useTargetingProblems(flag, value, segmentKeys)` returns `{ all, summary, offVariant, fallthrough, rules, isValid }`
(`rules` is index-aligned). Use `isValid` to disable Save. New rule ids use `crypto.randomUUID()` with a
fallback for insecure (plain HTTP) contexts.

## RuleCard

`rule, index (0-based), total, flag, segments, attributeSuggestions?, onChange(rule), onRemove(), onMove('up' | 'down'), disabled?, problems?: string[]`

Header (position, description, move, delete with confirmation), conditions joined by "and", footer serve editor.

## ConditionRow

`condition, onChange(condition), onRemove(), segments, attributeSuggestions?, disabled?, index`

Attribute conditions (attribute with datalist, grouped operator select, value editor per operator) and
segment conditions. The kebab menu switches kind or removes. `OPERATOR_GROUPS`, `OPERATOR_KEYS` (translation keys under `flags:conditions.operators`) and
`valueKind` are exported for reuse (e.g. segment editors).

## ServeEditor

`flag: Pick<FlagDefinition, 'type' | 'variants'>, value: Serve, onChange(serve), disabled?, label?, allowRollout? = true`

Variant or percentage rollout (weights, live bar, total with error state, Split evenly, Reset, Advanced "Bucket by").
Rollout state always lists every variant of the flag; zero weights are kept in the data.

## VariantValue / VariantSelect

`VariantValue`: `value, type, variantKey?, index?, hideValue?, className?`. Colour comes from `index`
(position in the flag's variants), falling back to a hash of `variantKey`.
`VariantSelect`: `variants, value, onValueChange(key), type?, disabled?, placeholder?, id?, aria-label?, aria-invalid?, className?`.
`variantColor(index)` returns `var(--chart-1..5)`.

## RolloutBar

`variations: RolloutVariation[], variants: Variant[], height?, showLabels?, type?, className?`.
`role="img"` with a label such as "a 50%, b 20%". Gaps under 100% are hatched.

## VariantsEditor

`type: FlagType, value: Variant[], onChange, disabled?, minVariants? = 2, lockedKeys?, onValidityChange?(valid)`

Key, value (per type), optional name. Locked keys cannot be renamed or removed. Boolean flags are forced to
exactly one `true` and one `false` variant (values read-only, keys and names editable). Invalid JSON
keeps the last valid value in `value`; use `onValidityChange` (or `validateFlagDefinition`) to block saving.

## FlagTypeBadge

`type: FlagType, className?` renders `bool`, `str`, `num` or `json` with a tooltip.

## Other exports

`IconButton` (ghost icon button with tooltip and `aria-label`, optional `disabledReason`), `TagInput`,
`useStableKeys`, `newId`, `evenSplit`, `rolloutFrom`, `primaryVariant`, `sumWeights`.

## Formatting helpers (`@/lib/format`)

`formatVariantValue(value, type, { maxLength? })`, `formatPercent(weight)`, `formatRelativeTime(date, { now?, locale? })`,
`formatDateTime(date, locale?)`. Counts use plural translation keys (`t('common:counts.rules', { count })`).
