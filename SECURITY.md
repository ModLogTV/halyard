# Security policy

Halyard is self-hosted software: you run it on your own infrastructure. We take reports about
vulnerabilities in the application, the published packages (`@modlogtv/halyard-engine`,
`@modlogtv/halyard-cli`), the container image and the Helm chart seriously.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report them privately through
[GitHub's private vulnerability reporting](https://github.com/ModLogTV/halyard/security/advisories/new)
for this repository. Include the affected version, a description of the issue and, if possible, steps
to reproduce it.

You will get an acknowledgement within a few days. We aim to publish a fix and a GitHub security
advisory as soon as a fix is available, and we credit reporters who want to be credited.

## Supported versions

Only the latest release receives security fixes. Follow the release notes and keep your instance on
a current version; upgrades are described in [docs/deployment.md](docs/deployment.md#upgrading).

## Hardening a self-hosted instance

- Terminate TLS in front of Halyard and set `BETTER_AUTH_URL` to the public `https://` URL.
- Keep `AUTH_SIGNUP_MODE=invite` (the default) when the instance is reachable from the internet.
- Use a strong, random `BETTER_AUTH_SECRET` and keep it out of version control.
- Set `METRICS_TOKEN` if `/metrics` is reachable from outside your monitoring network.
- Set `WEBHOOK_BLOCK_PRIVATE_NETWORKS=true` unless webhooks must reach internal services.
- Run the container read-only (`--read-only --tmpfs /tmp`, as the Compose file and Helm chart do).
