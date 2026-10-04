# Contributing

Thanks for your interest in Halyard.

## Development setup

```sh
cp .env.example .env
docker compose up -d
bun run setup
bun run dev
```

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
`publishConfig` entry points and calls `npm publish --provenance`. Try it locally with
`bun run release -- --dry-run` or `bun run scripts/publish.ts --dry-run`.
