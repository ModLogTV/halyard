# Contributing

Thanks for your interest in Halyard.

## Development setup

```sh
cp .env.example .env
docker compose up -d
bun run setup
bun run dev
```

The root `.env` is the only one: docker compose and every `apps/web` script (`dev`, `start`, `test`,
`db:*`) read it. Change the app port with `PORT` and the Postgres port with `POSTGRES_PORT`;
`BETTER_AUTH_URL` follows `PORT` unless you set it.

## Checks

Package tasks run through Turborepo (`turbo.json`), so results are cached per package.

```sh
bun run lint        # Biome (repo wide)
bun run typecheck   # turbo run typecheck
bun run test        # turbo run test; backend tests need the Postgres from docker compose
bunx turbo run test --filter=@modlogtv/halyard-engine   # one package
```

Backend code is written test-first. The evaluation engine in `packages/engine` must stay dependency-free.

## Conventions

- TypeScript strict, 2 spaces, single quotes, no semicolons (enforced by Biome).
- UI uses shadcn/ui components only; do not hand-roll components shadcn provides.
- Every interactive element without visible text needs a tooltip and an accessible label.
- Code, comments, commit messages and docs are in English.

## Releasing the packages

`@modlogtv/halyard-engine` and `@modlogtv/halyard-cli` are published to npm with
[Changesets](https://github.com/changesets/changesets). The web app is not published to npm; it
ships as a container image and Helm chart (see `.github/workflows/release.yml`).

1. When a change should reach npm, add a changeset in the same PR: `bun run changeset`. Pick the
   affected packages and a semver bump, and write the release note users will read.
2. On merge to `main`, the "Publish packages" workflow opens or updates a **Version packages** PR
   that bumps versions and writes the changelogs.
3. Merging that PR publishes the new versions, tags them (`<name>@<version>`) and creates GitHub
   releases.

The publish step runs `scripts/publish.ts`, which resolves `workspace:` ranges, applies the
`publishConfig` entry points and calls `npm publish` (with `--provenance` in CI). Try it locally with
`bun run scripts/publish.ts --dry-run`.

### npm authentication

The workflow authenticates with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC), so no npm token is stored in the repository. npm is phasing out 2FA-bypass tokens for
publishing, which is why we do not rely on one. Setting up a **new** package:

1. Publish it once from your machine, interactively with 2FA: `npm login`, then `bun run release`.
2. On npmjs.com open the package settings and add a trusted publisher: GitHub Actions, repository
   `ModLogTV/halyard`, workflow `publish.yml`.

From then on the workflow publishes new versions on its own.
