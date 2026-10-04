# Deployment

Halyard ships as a single container image plus an external PostgreSQL database (14 or newer). There is no Redis, queue or other dependency.

- Image: `ghcr.io/<owner>/<repo>` (tags: `edge` for `main`, `latest`, `X.Y.Z`, `X.Y`, and `sha-<commit>`), multi-arch `linux/amd64` and `linux/arm64`.
- Helm chart: `oci://ghcr.io/<owner>/charts/halyard`.
- The image is based on `oven/bun:<version>-slim`, runs as the non-root user `bun` (uid 1000), listens on port `3000` and exposes `GET /healthz`.

Build the image yourself from the repository root (the Vite build is run through Turborepo, `bunx turbo run build --filter=@halyard/web`):

```sh
docker build -t halyard:dev .
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | | Postgres connection string, e.g. `postgresql://user:pass@host:5432/halyard`. Use a direct (session) connection, see [Multiple replicas](#multiple-replicas). |
| `BETTER_AUTH_SECRET` | yes | | Session signing secret, at least 16 characters (use 32+ random). `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | recommended | `http://localhost:3000` | Public URL of the app. Used for cookies and redirects; set it to the URL users open in the browser. |
| `PORT` | no | `3000` | Port the server listens on. |
| `RUN_MIGRATIONS_ON_STARTUP` | no | `true` | Run database migrations before serving traffic. |
| `ENABLE_WORKERS` | no | `true` | Run background workers (scheduled changes, webhook delivery, stats flushers). |
| `WEBHOOK_BLOCK_PRIVATE_NETWORKS` | `false` | Refuse webhook targets resolving to loopback, private, link-local or CGNAT addresses. Recommended on multi-tenant instances. |
| `SCHEDULER_INTERVAL_MS` | `15000` | Poll interval of the scheduled-change worker (it also wakes on change events). |
| `WEBHOOK_DISPATCH_INTERVAL_MS` | `10000` | Poll interval of the webhook dispatcher. |
| `METRICS_TOKEN` | no | unset | When set, `GET /metrics` requires `Authorization: Bearer <token>`. |

Endpoints for operations:

- `GET /healthz` returns `200 {"status":"ok"}` when Postgres is reachable and `503` otherwise.
- `GET /metrics` returns Prometheus metrics in the text format.

The server runs migrations and starts its workers before it begins listening, so on first start (or after an upgrade with new migrations) the port opens a little later than the process starts. Health checks need a start period (the image `HEALTHCHECK` and the Helm startup probe already allow for this).

## Docker

```sh
docker run -d --name halyard \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://halyard:change-me@db.example.com:5432/halyard \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BETTER_AUTH_URL=https://flags.example.com \
  ghcr.io/<owner>/<repo>:latest
```

Keep `BETTER_AUTH_SECRET` stable across restarts and replicas, otherwise sessions are invalidated. The container's root filesystem can be read-only (`--read-only --tmpfs /tmp`).

## Docker Compose (production example)

Put the secrets in an `.env` file next to `compose.yaml` (`POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`) and keep it out of version control.

```yaml
# compose.yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: halyard
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}
      POSTGRES_DB: halyard
    volumes:
      - halyard-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U halyard -d halyard"]
      interval: 5s
      timeout: 5s
      retries: 10

  halyard:
    image: ghcr.io/<owner>/<repo>:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://halyard:${POSTGRES_PASSWORD}@postgres:5432/halyard
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: https://flags.example.com
      # METRICS_TOKEN: ${METRICS_TOKEN}
    read_only: true
    tmpfs:
      - /tmp

volumes:
  halyard-pgdata:
```

```sh
docker compose up -d
docker compose logs -f halyard
```

Terminate TLS in front of the app (Caddy, Traefik, nginx) and make `BETTER_AUTH_URL` the public `https://` URL. Back up the `halyard-pgdata` volume (or use `pg_dump`); all state lives in Postgres.

## Kubernetes (Helm)

The chart expects an external Postgres. Install from the OCI registry:

```sh
helm install halyard oci://ghcr.io/<owner>/charts/halyard \
  --version 0.1.0 \
  --namespace halyard --create-namespace \
  --set database.url=postgresql://halyard:change-me@postgres.example.com:5432/halyard \
  --set auth.secret="$(openssl rand -base64 32)" \
  --set auth.url=https://flags.example.com \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set 'ingress.hosts[0].host=flags.example.com' \
  --set 'ingress.hosts[0].paths[0].path=/' \
  --set replicaCount=2
```

Chart versions published from a `vX.Y.Z` tag use `X.Y.Z` as both chart version and app version, and the default `image.repository` points at the image built by the same release. When installing from a checkout, set `image.repository` yourself: `helm install halyard ./deploy/helm/halyard --set image.repository=ghcr.io/<owner>/<repo> ...`.

### Secrets

By default the chart creates a Secret from `database.url`, `auth.secret` and (optionally) `metrics.token`. To manage secrets yourself (External Secrets, Sealed Secrets, ...) create a Secret and reference it:

```sh
kubectl -n halyard create secret generic halyard-secrets \
  --from-literal=DATABASE_URL=postgresql://halyard:change-me@postgres.example.com:5432/halyard \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=METRICS_TOKEN="$(openssl rand -hex 24)"

helm install halyard oci://ghcr.io/<owner>/charts/halyard \
  --set existingSecret=halyard-secrets \
  --set metrics.existingSecretHasToken=true \
  --set auth.url=https://flags.example.com
```

If only the connection string lives in another Secret (for example one created by a Postgres operator), use `database.existingSecret` and `database.existingSecretKey`; `auth.secret` still comes from the chart-managed Secret.

### Useful values

| Value | Default | Purpose |
| --- | --- | --- |
| `replicaCount` | `1` | Replicas; any number is safe. |
| `autoscaling.enabled` | `false` | HorizontalPodAutoscaler (CPU/memory targets). |
| `pdb.enabled` | `false` | PodDisruptionBudget (`minAvailable: 1` by default; needs 2+ replicas to allow drains). |
| `config.runMigrationsOnStartup` | `true` | Migrate when a pod starts. |
| `config.enableWorkers` | `true` | Run background workers in every pod. |
| `migrations.job.enabled` | `false` | Run migrations in a Helm hook Job instead. |
| `extraEnv`, `extraEnvFrom` | `[]` | Additional environment. |
| `resources` | 100m / 256Mi, limit 512Mi | Container resources. |
| `metrics.serviceMonitor.enabled` | `false` | Create a Prometheus Operator ServiceMonitor. |

Probes: the Deployment uses `/healthz` for startup (up to 5 minutes, covering migrations), liveness and readiness. The pod security context is non-root (uid 1000), with a read-only root filesystem, no privilege escalation and all capabilities dropped; `/tmp` is an `emptyDir`.

### Migrations as a Job

With the default `config.runMigrationsOnStartup=true` every pod runs the migrations at startup. That is safe with multiple replicas (see below), but if you prefer explicit control, for example because the database role used by the pods should not be allowed to change the schema, run them as a Helm hook:

```sh
helm upgrade --install halyard oci://ghcr.io/<owner>/charts/halyard \
  --set migrations.job.enabled=true ...
```

The chart then runs `bun run apps/web/scripts/migrate.ts` in a `pre-install,pre-upgrade` Job and starts the pods with `RUN_MIGRATIONS_ON_STARTUP=false`. A failed Job fails the release and the old pods keep running. When the chart manages the Secret, it creates a short-lived copy of it as a hook resource for the Job (Helm runs pre-install hooks before regular resources exist). The migrate script needs the same environment as the app (`DATABASE_URL` and `BETTER_AUTH_SECRET`). Outside Kubernetes the same command works in any container of the image:

```sh
docker run --rm -e DATABASE_URL=... -e BETTER_AUTH_SECRET=... ghcr.io/<owner>/<repo>:latest \
  bun run apps/web/scripts/migrate.ts
```

## Multiple replicas

Halyard replicas are stateless apart from in-memory caches, and coordinate only through Postgres:

- **Cache invalidation** uses `LISTEN`/`NOTIFY` on the `halyard_events` channel. Each replica holds one dedicated listener connection. Connect directly to Postgres or use a pooler in session mode; PgBouncer in transaction mode does not support `LISTEN`.
- **Scheduled changes and webhook deliveries** are claimed with `FOR UPDATE SKIP LOCKED`, so each job runs exactly once even when every replica polls. You can therefore leave `ENABLE_WORKERS=true` everywhere, or run dedicated worker replicas by deploying a second release with `ENABLE_WORKERS=false` for the web tier.
- **Migrations** take a Postgres advisory lock. Several replicas starting at once is safe: one applies the migrations while the others wait, then continue.
- **Connection budget**: each replica opens up to 10 pooled connections plus one listener. Size `max_connections` for `replicas * 11` plus headroom.
- Use sticky sessions only if you want them; sessions are stored in Postgres and any replica can serve any request.

## Metrics

Prometheus metrics are served at `GET /metrics`. Set `METRICS_TOKEN` to require a bearer token:

```sh
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3000/metrics
```

With the Prometheus Operator installed, let the chart create a ServiceMonitor:

```sh
helm upgrade halyard oci://ghcr.io/<owner>/charts/halyard --reuse-values \
  --set metrics.token="$(openssl rand -hex 24)" \
  --set metrics.serviceMonitor.enabled=true \
  --set metrics.serviceMonitor.interval=30s \
  --set metrics.serviceMonitor.labels.release=kube-prometheus-stack
```

The ServiceMonitor scrapes the `http` port on `/metrics`. When a token is configured (`metrics.token`, or `existingSecret` with `metrics.existingSecretHasToken=true`) it sends it as a bearer token read from the `METRICS_TOKEN` key of the same Secret. Set `metrics.serviceMonitor.labels` to whatever label your Prometheus instance selects on, and `metrics.serviceMonitor.namespace` if ServiceMonitors must live in the monitoring namespace.

## Upgrading

1. Read the release notes for the version you are moving to.
2. Back up the database (`pg_dump`) before upgrades that contain migrations.
3. Docker / Compose: `docker compose pull && docker compose up -d`. Migrations run when the new container starts. Pin a version tag (`X.Y.Z`) instead of `latest` for predictable upgrades.
4. Helm: `helm upgrade halyard oci://ghcr.io/<owner>/charts/halyard --version <new> --reuse-values` (or pass your values file). The Deployment rolls with `maxUnavailable: 0`, so ready pods keep serving while new pods migrate and start. If you use the migration Job, it runs before the rollout.
5. Migrations are forward-only. During a rolling upgrade, old and new versions briefly run against the migrated schema, so expect schema changes to be backwards compatible within a release line; to roll back across a migration, restore the backup.
6. Check `GET /healthz` and the pod logs after the rollout.

Changing `auth.secret` / `BETTER_AUTH_SECRET` signs everybody out. Changing `auth.url` / `BETTER_AUTH_URL` changes cookie and redirect origins; update it together with your ingress host.
