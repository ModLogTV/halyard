<img src="assets/icon.svg" width="64" height="64" alt="">

# Halyard

Self-hosted feature flags with a modern UI. Projects, environments, targeting rules,
segments, sticky percentage rollouts, A/B experiments, scheduled changes, audit log,
webhooks, Prometheus metrics, and an [OpenFeature Remote Evaluation Protocol](https://github.com/open-feature/protocol)
endpoint so any OpenFeature SDK can evaluate flags without a vendor SDK.

> Work in progress. See the milestones in the commit history.

## Quick start

Requirements: [Bun](https://bun.sh) 1.3+, Docker.

```sh
cp .env.example .env
docker compose up -d
bun run setup        # installs dependencies, applies migrations, seeds demo data
bun run dev          # http://localhost:3000
```

## Repository layout

The repository is a Bun workspace orchestrated with [Turborepo](https://turborepo.com): `bun run build`, `bun run typecheck` and `bun run test` fan out to every package with caching, `bun run dev` starts the web app.

| Path | Purpose |
| --- | --- |
| `apps/web` | TanStack Start application: UI, API, OFREP endpoints, background workers |
| `packages/engine` | `@halyard/engine`: pure, dependency-free evaluation engine |
| `packages/cli` | `@halyard/cli`: type generation, import and export |

## License

MIT
