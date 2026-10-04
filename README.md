<img src="assets/icon.svg" width="64" height="64" alt="">

# Halyard

Self-hosted feature flags with a UI that feels like a modern product, and an
[OpenFeature Remote Evaluation Protocol](https://github.com/open-feature/protocol) endpoint
so every OpenFeature SDK can talk to it without a vendor SDK.

- **Projects, environments, flags.** Boolean, string, number and JSON flags, defined once per
  project and configured per environment: on/off, default, ordered targeting rules, sticky
  percentage rollouts.
- **Segments.** Reusable groups of users, referenced from any flag, with usage tracking.
- **Compare and promote.** See every flag side by side across environments, promote a
  configuration with a diff preview and a production confirmation.
- **Experiments.** Weighted variants on a flag, exposures recorded at evaluation, conversions via
  a tracking endpoint, results with confidence intervals and a two-proportion z-test.
- **Playground.** Evaluate any context against the live configuration and see which rule,
  segment or bucket decided, using the same engine as production.
- **Scheduled changes and staged rollouts.** Enable, disable or change a rollout at a point in
  time, or step a percentage up on a schedule. Runs exactly once with several replicas.
- **Stale flag detection, audit log, webhooks, Prometheus metrics.**
- **OFREP, local evaluation, CLI.** Single and bulk evaluation with ETags, a downloadable ruleset
  that the published `@modlogtv/halyard-engine` evaluates locally, and a CLI that generates TypeScript
  types from your flags and imports/exports projects (JSON and flagd).

## Quick start

Requirements: [Bun](https://bun.sh) 1.3+ and Docker.

```sh
git clone <this repository> halyard && cd halyard
cp .env.example .env
docker compose up -d        # Postgres
bun run setup               # install, migrate, seed demo data
bun run dev                 # http://localhost:3000
```

Sign in with `dev@example.com` / `password123` (project owner) or `admin@example.com` /
`password123` (instance admin). The seed prints SDK keys for each environment and a management
key for the CLI.

Evaluate a flag with any OpenFeature SDK using the generic OFREP provider:

```ts
import { OpenFeature } from '@openfeature/server-sdk'
import { OFREPProvider } from '@openfeature/ofrep-provider'

await OpenFeature.setProviderAndWait(
  new OFREPProvider({
    baseUrl: 'http://localhost:3000',
    headers: [['Authorization', 'Bearer hal_sdk_…']],
  }),
)
const client = OpenFeature.getClient()
const enabled = await client.getBooleanValue('checkout.new-payment-flow', false, {
  targetingKey: 'user-42',
  country: 'DE',
})
```

Or with plain HTTP:

```sh
curl -X POST http://localhost:3000/ofrep/v1/evaluate/flags/checkout.new-payment-flow \
  -H "Authorization: Bearer hal_sdk_…" -H "Content-Type: application/json" \
  -d '{"context":{"targetingKey":"user-42","country":"DE"}}'
```

## Repository layout

The repository is a Bun workspace orchestrated with [Turborepo](https://turborepo.com).

| Path | Purpose |
| --- | --- |
| `apps/web` | TanStack Start application: UI, server functions, OFREP and REST endpoints, background workers |
| `packages/engine` | `@modlogtv/halyard-engine`: pure, dependency-free evaluation engine ([README](packages/engine/README.md)) |
| `packages/cli` | `@modlogtv/halyard-cli`: type generation, import and export ([docs](docs/cli.md)) |
| `deploy/helm/halyard` | Helm chart ([deployment guide](docs/deployment.md)) |
| `docs` | Architecture, deployment, experiments, webhooks, scheduled changes, import/export, REST API |

```sh
bun run dev          # web app with hot reload
bun run build        # turbo run build across packages
bun run typecheck    # turbo run typecheck
bun run test         # turbo run test (backend tests need the Postgres from docker compose)
bun run lint         # Biome
```

## How it works

- **Evaluation** happens in `@modlogtv/halyard-engine`, a pure function from (flag definition, environment
  configuration, segments, context) to a value with a reason. The server keeps one ruleset per
  environment in memory, invalidated through Postgres `LISTEN`/`NOTIFY` on every write, so
  evaluation does not touch the database per request. Evaluation stats and experiment exposures
  are buffered and written in batches.
- **Projects are better-auth organizations.** Roles `owner`, `editor` and `viewer` are enforced on
  the server through the organization plugin's access control. Instance admins come from the
  admin plugin.
- **API keys** are hashed at rest. SDK keys are scoped to one environment; management keys are
  scoped to a project with read or write access.
- **Multiple replicas** are supported out of the box: cache invalidation via `LISTEN`/`NOTIFY`,
  scheduled changes and webhook deliveries claimed with `FOR UPDATE SKIP LOCKED`, migrations
  guarded by an advisory lock.
- **Languages.** The UI ships in English and German. The language follows a `halyard_locale`
  cookie, then the browser's `Accept-Language`, and can be switched from the account menu.
  Translations live in `apps/web/src/locales`; see its README to add a language.

See [docs/architecture.md](docs/architecture.md) for details.

## Production

A multi-stage `Dockerfile` builds a Bun image published to GHCR by the release workflow, and the
Helm chart deploys it against an external Postgres with probes, secrets, ingress and an optional
`ServiceMonitor`. Runtime is Bun in production as well as in development.

```sh
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://halyard:halyard@db:5432/halyard \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  -e BETTER_AUTH_URL=https://flags.example.com \
  ghcr.io/<owner>/halyard:latest
```

Configuration is documented in [`.env.example`](.env.example) and [docs/deployment.md](docs/deployment.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Deployment (Docker, Compose, Helm)](docs/deployment.md)
- [Experiments and statistics](docs/experiments.md)
- [Scheduled changes](docs/scheduled-changes.md)
- [Webhooks](docs/webhooks.md)
- [Import, export and flagd](docs/import-export.md)
- [REST API](docs/rest-api.md)
- [CLI](docs/cli.md)
- [UI translations](apps/web/src/locales/README.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT
