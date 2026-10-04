# Architecture

Halyard is a Bun workspace with three packages, orchestrated with Turborepo (`turbo.json` defines the `build`, `typecheck`, `test` and `db:*` tasks and their dependencies).

| Package | Purpose |
| --- | --- |
| `apps/web` | TanStack Start application: the UI, server functions, OFREP and REST endpoints, background workers |
| `packages/engine` | `@modlogtv/halyard-engine`, a pure evaluation engine with no dependencies |
| `packages/cli` | `@modlogtv/halyard-cli`, type generation and import/export |

## Data model

- A **project** is a [better-auth organization](https://www.better-auth.com/docs/plugins/organization). Membership and the roles `owner`, `editor` and `viewer` are organization roles; the permission statements live in `apps/web/src/lib/permissions.ts` and are enforced on the server with `auth.api.hasPermission`.
- A project owns **environments**, **flags** and **segments**. A flag is defined once per project (key, type, variants, tags) and has one **flag environment** row per environment holding `enabled`, `offVariant`, `fallthrough` and `rules`.
- **Experiments**, **scheduled changes**, **webhooks**, **API keys** and the **audit log** hang off a project; exposures and conversions hang off an experiment.

The JSON shapes stored in `rules`, `fallthrough`, `variants` and `conditions` are the engine's types (`packages/engine/src/types.ts`). The server never interprets them itself: it assembles a `Ruleset` per environment and calls the engine.

## Evaluation path

```
SDK key ──▶ authenticateSdkKey (60 s in-memory cache, invalidated on key changes)
        ──▶ getRuleset(environmentId) (in-memory cache, invalidated via events)
        ──▶ @modlogtv/halyard-engine evaluate
        ──▶ response; evaluation stats and exposures go to an in-memory buffer
            that is flushed to Postgres in batches
```

The playground, the OFREP endpoints and the ruleset download all use the same engine package. The engine is published so that clients can evaluate a downloaded ruleset locally when the server is unreachable.

## Multiple replicas

Every replica is stateless apart from caches.

- **Cache invalidation** uses Postgres `LISTEN`/`NOTIFY` on the channel `halyard_events`. Writes call `pg_notify` inside the transaction that changes the data, so the notification is only delivered on commit. Each replica keeps one listener connection and drops the affected cache entries. A safety TTL re-reads cache entries every few minutes in case a notification was missed.
- **Scheduled changes and webhook deliveries** are rows claimed with `SELECT … FOR UPDATE SKIP LOCKED` and a status transition inside one transaction, so a job runs exactly once even when several replicas poll at the same time.
- **Migrations** run on startup (`RUN_MIGRATIONS_ON_STARTUP`); Drizzle takes an advisory lock, so concurrent starts are safe. Set the variable to `false` and run `bun run db:migrate` as a job if you prefer explicit control.

## Authentication

- Users sign in with email and password (better-auth). Organization, admin and API key plugins are used as-is.
- **SDK keys** (`hal_sdk_…`) are owned by a project and scoped to one environment. They authenticate OFREP, the ruleset download and the tracking endpoint.
- **Management keys** (`hal_mgmt_…`) are owned by a project and carry `read` or `read, write` permissions for the REST API used by the CLI.
- Only hashes of keys are stored; the plaintext is shown once at creation.
