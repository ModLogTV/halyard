# syntax=docker/dockerfile:1.7

# Halyard production image.
#
#   docker build -t halyard:dev .
#   docker run --rm -p 3000:3000 \
#     -e DATABASE_URL=postgresql://user:pass@host:5432/halyard \
#     -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
#     -e BETTER_AUTH_URL=http://localhost:3000 \
#     halyard:dev

ARG BUN_VERSION=1.3.14

# ---------------------------------------------------------------------------
# base: Bun toolchain shared by the build stages
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# manifests: only the files that influence dependency resolution, so the
# install layers stay cached until a package.json or the lockfile changes.
# ---------------------------------------------------------------------------
FROM base AS manifests
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/cli/package.json packages/cli/package.json

# ---------------------------------------------------------------------------
# deps: full install (including dev dependencies) used by the build stage
# ---------------------------------------------------------------------------
FROM manifests AS deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# prod-deps: runtime-only dependencies for the final image
# ---------------------------------------------------------------------------
FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------
# build: compile the TanStack Start app (Vite, orchestrated by Turborepo)
# into apps/web/dist
# ---------------------------------------------------------------------------
FROM deps AS build
ENV NODE_ENV=production \
    TURBO_TELEMETRY_DISABLED=1
COPY tsconfig.base.json turbo.json ./
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN bunx turbo run build --filter=@halyard/web

# ---------------------------------------------------------------------------
# runtime: minimal image, non-root
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Production dependencies. Bun's isolated install keeps the real packages in
# node_modules/.bun and links the workspace packages from there.
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=prod-deps --chown=bun:bun /app/apps/web/node_modules ./apps/web/node_modules
COPY --chown=bun:bun package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY --chown=bun:bun packages/engine/package.json packages/engine/package.json
COPY --chown=bun:bun packages/engine/src packages/engine/src

# App: server wrapper, build output, migrations. src/ + tsconfig.json + scripts/
# are included so `bun run apps/web/scripts/migrate.ts` works (used by the Helm
# migration Job); Bun resolves the "@/" alias through apps/web/tsconfig.json.
COPY --chown=bun:bun apps/web/package.json apps/web/tsconfig.json apps/web/server.ts apps/web/
COPY --chown=bun:bun apps/web/drizzle apps/web/drizzle
COPY --chown=bun:bun apps/web/scripts apps/web/scripts
COPY --chown=bun:bun apps/web/src apps/web/src
COPY --from=build --chown=bun:bun /app/apps/web/dist apps/web/dist


USER 1000:1000
EXPOSE 3000

# The slim image has no curl; use Bun itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["bun", "run", "apps/web/server.ts"]
