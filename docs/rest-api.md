# Management REST API

The management API is what the Halyard CLI and CI scripts use. It is project-scoped: a
**management key** belongs to exactly one project, and every endpoint operates on that project.

Create a key under **Settings → API keys → Create management key** and choose *Read* or
*Read & write* access. The key is shown once.

```sh
export HALYARD_URL=https://flags.example.com
export HALYARD_KEY=hal_mgmt_xxxxxxxxxxxxxxxx
```

## Authentication and errors

Send the key as a bearer token (`x-api-key: <key>` also works):

```
Authorization: Bearer hal_mgmt_xxxxxxxxxxxxxxxx
```

| Key access | Allowed |
| --- | --- |
| Read | every `GET` endpoint |
| Read & write | everything, including `POST /api/v1/import` |

A key acts as a project **editor** (write) or **viewer** (read). It can never manage members, API keys or the project
itself. Environment changes (`create`, `update`, `delete`) are not an editor permission, so an import
that changes environments is refused for keys; see [Import](#post-apiv1import).

Errors are JSON with a stable `error` code and a human readable `message`:

```json
{ "error": "UNAUTHORIZED", "message": "Provide a management key in the Authorization header" }
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | malformed body or query, unknown environment |
| 401 | `UNAUTHORIZED` | no key, not a management key, or an invalid or revoked key |
| 403 | `FORBIDDEN` | the key lacks the permission (for example a read key on `import`) |
| 413 | `PAYLOAD_TOO_LARGE` | request body above 10 MB |
| 422 | `IMPORT_REJECTED` | the import document has problems; nothing was changed |
| 500 | `INTERNAL` | unexpected error |

## GET /api/v1/projects/current

The project of the key and its environments.

```sh
curl -s "$HALYARD_URL/api/v1/projects/current" -H "Authorization: Bearer $HALYARD_KEY"
```

```json
{
  "id": "xK3...",
  "name": "Acme",
  "slug": "acme",
  "description": null,
  "environments": [
    { "id": "6f1c...", "key": "development", "name": "Development", "color": "#3b82f6", "isProduction": false },
    { "id": "0a9e...", "key": "production", "name": "Production", "color": "#e11d48", "isProduction": true }
  ]
}
```

## GET /api/v1/flags

Flag definitions, archived flags included. Meant for type generation.

```sh
curl -s "$HALYARD_URL/api/v1/flags" -H "Authorization: Bearer $HALYARD_KEY"
```

```json
{
  "flags": [
    {
      "key": "checkout",
      "name": "New checkout",
      "description": "The redesigned checkout",
      "type": "boolean",
      "variants": [
        { "key": "on", "value": true, "name": "On" },
        { "key": "off", "value": false, "name": "Off" }
      ],
      "tags": ["payments"],
      "archived": false
    }
  ]
}
```

## GET /api/v1/export

The [export document](import-export.md#format). Add `?download=1` to receive it as an attachment
(`Content-Disposition: attachment; filename="<slug>-export.json"`).

```sh
curl -s "$HALYARD_URL/api/v1/export" -H "Authorization: Bearer $HALYARD_KEY" > acme.json
curl -sOJ "$HALYARD_URL/api/v1/export?download=1" -H "Authorization: Bearer $HALYARD_KEY"
```

## GET /api/v1/export/flagd?environment=\<key\>

One environment as a [flagd](https://flagd.dev) flag definition file, plus warnings for everything flagd cannot
express exactly (see [the mapping](import-export.md#flagd-export)). Answers 400 when the environment is missing or unknown.

```sh
curl -s "$HALYARD_URL/api/v1/export/flagd?environment=production" \
  -H "Authorization: Bearer $HALYARD_KEY" | jq .flagd > flags.flagd.json
```

```json
{
  "flagd": {
    "$schema": "https://flagd.dev/schema/v0/flags.json",
    "flags": {
      "checkout": {
        "state": "ENABLED",
        "variants": { "on": true, "off": false },
        "defaultVariant": "off",
        "targeting": { "if": [{ "$ref": "beta-users" }, "on"] }
      }
    },
    "$evaluators": { "beta-users": { "==": [{ "var": "plan" }, "pro"] } },
    "metadata": { "source": "halyard", "project": "acme", "environment": "production" }
  },
  "warnings": [
    "Flag \"search\" is disabled in \"production\": flagd serves the code default for disabled flags, so the off variant \"off\" is lost"
  ]
}
```

## POST /api/v1/import

Needs a **read & write** key. Body:

```json
{ "document": { "version": 1, "...": "..." }, "prune": false, "dryRun": false }
```

| Field | Default | Meaning |
| --- | --- | --- |
| `document` | required | an [export document](import-export.md#format) |
| `prune` | `false` | also delete flags, segments and environments that are not in the document |
| `dryRun` | `false` | compute and return the diff, write nothing |

```sh
# What would change?
curl -s "$HALYARD_URL/api/v1/import" -H "Authorization: Bearer $HALYARD_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"document\": $(cat acme.json), \"dryRun\": true}" | jq .diff

# Apply it
curl -s "$HALYARD_URL/api/v1/import" -H "Authorization: Bearer $HALYARD_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"document\": $(cat acme.json)}"
```

Response (200):

```json
{
  "diff": {
    "environments": { "create": [], "update": [], "unchanged": 3, "delete": [] },
    "segments": { "create": [], "update": [], "unchanged": 2, "delete": [] },
    "flags": {
      "create": [],
      "update": [
        {
          "key": "checkout",
          "name": "New checkout",
          "changes": [],
          "environments": [
            {
              "environmentKey": "production",
              "changes": [{ "field": "enabled", "before": false, "after": true }]
            }
          ]
        }
      ],
      "unchanged": 3,
      "delete": []
    }
  },
  "errors": [],
  "warnings": [],
  "applied": true
}
```

- `diff.<entity>.create` holds the entities as they appear in the document, `update` the field-level `changes`
  (`{ field, before, after }`); flags also list the changed configurations per environment. `delete`
  is only filled when `prune` is set. `unchanged` counts entities that already match.
- `applied` is `false` for a dry run and when the document is rejected.
- A **document with problems** (invalid keys, unknown variants, rollout weights not adding up to 100, ...)
  answers **422** with `{ "error": "IMPORT_REJECTED", "message": "...", "diff", "errors", "warnings", "applied": false }`.
  Nothing is applied while any problem remains. A dry run reports the same `errors` with status 200.
- A document that already matches the project changes nothing: no audit rows, no version bumps, no cache
  invalidation.
- Everything is applied in one transaction and recorded in the audit log, attributed to the key (actor type
  `api_key`) with one `import.applied` summary row plus a row per created, updated or deleted entity.
- Management keys act as editors, who may create, update and delete flags and segments but not environments.
  Documents that create, update or delete environments are therefore refused with 403 for keys (a dry run lists
  the reason under `errors`). Import such documents in the UI as a project owner, or send documents whose
  `environments` equal the project's.
