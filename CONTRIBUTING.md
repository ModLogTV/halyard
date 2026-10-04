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
bunx turbo run test --filter=@halyard/engine   # one package
```

Backend code is written test-first. The evaluation engine in `packages/engine` must stay dependency-free.

## Conventions

- TypeScript strict, 2 spaces, single quotes, no semicolons (enforced by Biome).
- UI uses shadcn/ui components only; do not hand-roll components shadcn provides.
- Every interactive element without visible text needs a tooltip and an accessible label.
- Code, comments, commit messages and docs are in English.
