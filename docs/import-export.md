# Import and export

Halyard can export a project's configuration as a JSON document, import such a document into the same or another
project, and export one environment as a [flagd](https://flagd.dev) flag definition file.

- UI: **Settings → Import & export**
- REST: `GET /api/v1/export`, `GET /api/v1/export/flagd`, `POST /api/v1/import`, see [rest-api.md](rest-api.md)

Exports contain no secrets, API keys, members, evaluation statistics, experiments or scheduled changes. The export
permission (`transfer:export`) belongs to every role; importing (`transfer:import`) to editors and owners.

## Format

Format version 1:

```jsonc
{
  "version": 1,
  "exportedAt": "2026-10-04T10:00:00.000Z",
  "project": { "slug": "acme", "name": "Acme", "description": null },   // informational, never imported
  "environments": [
    { "key": "production", "name": "Production", "color": "#e11d48", "isProduction": true, "sortOrder": 2 }
  ],
  "segments": [
    {
      "key": "beta-users", "name": "Beta users", "description": null, "match": "all",
      "conditions": [{ "type": "attribute", "attribute": "plan", "operator": "eq", "value": "pro" }]
    }
  ],
  "flags": [
    {
      "key": "checkout", "name": "New checkout", "description": null,
      "type": "boolean",
      "variants": [{ "key": "on", "value": true }, { "key": "off", "value": false }],
      "tags": ["payments"],
      "archived": false,
      "environments": {
        "production": {
          "enabled": true,
          "offVariant": "off",
          "fallthrough": { "type": "rollout", "variations": [{ "variant": "on", "weight": 20 }, { "variant": "off", "weight": 80 }] },
          "rules": [
            {
              "id": "9c5b…", "description": "Beta users",
              "conditions": [{ "type": "segment", "segmentKey": "beta-users" }],
              "serve": { "type": "variant", "variant": "on" }
            }
          ]
        }
      }
    }
  ]
}
```

The shapes of conditions, serves, rules and variants are the engine types (`packages/engine/src/types.ts`).
The ordering is deterministic: environments by sort order, segments and flags by key; archived flags are included.
Unknown extra keys are ignored on import. Optional values (`description`, `tags`, `archived`, `color`, `isProduction`,
`match`, rule `id`s) may be left out of hand-written documents.

## Importing

1. The document is checked: structure (zod), then the engine validators for keys, variants, rollout weights,
   conditions and segment references. Entities are reported per flag, segment and environment.
2. It is compared with the project. **Entities are matched by key.** Rules compare by value; rule ids are ignored when
   everything else is equal, and the ids already stored are kept in that case.
3. The result is a diff with `create`, `update` (field-level changes, per-environment configuration changes for flags),
   `unchanged` and, only with prune, `delete` for environments, segments and flags.
4. Applying runs in one transaction in dependency order (environments, segments, flag definitions, flag environment
   configurations, deletions), writes the audit rows and invalidates the rulesets once.

**Additive by default.** Without *prune* nothing is ever deleted. With prune, flags, segments and environments that
are missing from the document are deleted; deleting an environment also revokes its SDK keys. A project always keeps
at least one environment.

**All or nothing.** Any problem (errors) stops the import: the UI keeps *Apply import* disabled, the API answers 422.
Warnings do not block:

| Warning | Meaning |
| --- | --- |
| `Environment "x" is not defined in the document; its configuration is skipped for N flags` | flag configs for environments the document does not list are skipped |
| `Flag "x" has no configuration for environment "y"; it is created disabled …` | a new flag without a config for a document environment gets the default config |

Problems that reject an import include: invalid keys, a variant that does not exist, rollout weights not adding up to
100, an unknown segment, duplicate keys, a flag whose **type** differs from the existing flag with that key, a removed
variant that is still used by a configuration the document leaves alone or by a running experiment, and a prune that
would delete every environment.

**Permissions.** Besides `transfer:import` the actor needs the permission of each kind of change: `flag` and `segment`
`create`/`update`/`delete` (editors and owners) and `environment` `create`/`update`/`delete` (owners only). An editor
whose import would change environments gets the reason in the preview and a 403 on apply. Management keys act as editors.

Importing the same document twice is a no-op; a re-import writes nothing, bumps no versions and produces no audit rows.

## flagd export

`GET /api/v1/export/flagd?environment=<key>` (or **Export for flagd** in the UI) converts one environment to a
[flagd flag definition](https://flagd.dev/reference/flag-definitions/), validated against the
[flagd JSON schema](https://github.com/open-feature/flagd-schemas). Everything flagd cannot express exactly is
reported as a warning; nothing is dropped silently.

| Halyard | flagd |
| --- | --- |
| flag key, variants (`key` → `value`) | `flags[key].variants` |
| enabled / disabled | `state: "ENABLED"` / `"DISABLED"` |
| fixed fallthrough | `defaultVariant` |
| rollout fallthrough | `fractional` as the last `if` branch (or the whole `targeting`); `defaultVariant` is the off variant |
| rules, in order | `{ "if": [cond1, serve1, cond2, serve2, …] }` |
| rule without conditions | ends the chain (becomes the `else`) |
| rule conditions (AND) | `{ "and": [...] }` |
| rule serving a variant / a rollout | the variant key / `fractional` |
| `eq`, `neq` | `==`, `!=` |
| `in`, `not_in` | `{ "in": [{var}, [..]] }`, wrapped in `!` |
| `contains`, `not_contains` | `{ "in": [value, {var}] }`, wrapped in `!` |
| `starts_with`, `ends_with` | `starts_with`, `ends_with` |
| `gt`, `gte`, `lt`, `lte` | `>`, `>=`, `<`, `<=` |
| `semver_eq/gt/gte/lt/lte` | `sem_ver: [{var}, "=" / ">" / ">=" / "<" / "<=", version]` |
| `exists`, `not_exists` | `{ "!!": [{var}] }`, `{ "!": [{var}] }` |
| segment | one `$evaluators` entry named by the segment key (`any` → `or`, `all` → `and`) |
| segment condition | `{ "$ref": "key" }`, `negate` → `{ "!": [..] }` |
| description, tags | flag `metadata` (`description`, `tags` joined with commas) |
| `bucketBy` | the attribute in `{ "cat": [{ "var": "$flagd.flagKey" }, { "var": "<bucketBy>" }] }` (default `targetingKey`) |

Rollout weights are percentages in Halyard and relative integers in flagd; decimal weights are scaled up
(`33.3` → `333`).

Warnings that can be produced:

| Warning | Cause |
| --- | --- |
| `Flag "x" is disabled in "env": flagd serves the code default for disabled flags, so the off variant "v" is lost` | disabled flags |
| `… serves a percentage rollout, which is exported as flagd's "fractional" operator; flagd buckets users with a different hash than Halyard, so the same user can get a different variant` | any rollout (fallthrough or rule); assignments are sticky within flagd but differ from Halyard's |
| `Flag "x" rule N is skipped: the "regex" operator on "attr" has no flagd equivalent` | `regex` conditions; the rule is dropped, later rules and the fallthrough apply instead |
| `Segment "s" is skipped: …` and `Flag "x" rule N is skipped: segment "s" cannot be expressed in flagd` | a segment that uses `regex` (or a non-semver version for `semver_*`) cannot be built, and neither can the rules that use it |
| `Flag "x" rule N: "exists" on "attr" is exported as a JsonLogic truthiness test, …` | `exists` / `not_exists`: empty strings, `0` and `false` count as missing in flagd |
| `Flag "x" is archived and is not exported` | archived flags |
| `Flag "x" has no configuration for environment "env" and is skipped` | the document lacks that configuration |
| `Flag "x" is skipped: variant "v" is not a JSON object, …` | JSON flags with non-object variants (flagd object flags need objects) |

Other notes: flagd compares attribute types more loosely or strictly than Halyard in a few corner cases (for example
`in` on an array-valued attribute), and Halyard's `semver_*` versions with a leading `v` are normalised.
