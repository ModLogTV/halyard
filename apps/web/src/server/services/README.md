# Service layer

Business logic lives in plain functions in this directory. They never import TanStack
and know nothing about HTTP; `src/server/functions/*` wraps them in thin server functions.

## Authorization model

Two layers, both enforced on the server:

1. **Server function** resolves the caller with `projectActor(projectId, permissions)` or
   `userActor()` (`src/server/request-actor.ts`). That checks the session, project
   membership and the permission set through the organization plugin (the source of
   truth for roles is `src/lib/permissions.ts`) and returns an explicit actor.
2. **Service** receives that actor and re-checks it with `assertProjectAccess(actor,
   projectId, permissions)` from `authz.ts` on every operation. This verifies that the actor was
   authorized for the same project as the one in the input and evaluates the actor's role
   against the static role definitions (synchronous, no database access). Services that
   call better-auth endpoints (projects, members, API keys) additionally forward the
   caller's headers, so the plugin performs its own, authoritative membership and
   permission check; a forged `role` on an actor therefore never gets further than the
   service check.

Because services take the actor as a parameter they are unit-tested directly with actors of
different roles (see `test/*.service.test.ts` and `test/factories.ts`).

Actor types: `ProjectActor` (no headers) for services that only touch our own tables,
`ProjectActorWithHeaders` / `UserActorWithHeaders` for services that call `auth.api.*`.

## Conventions

- Input is validated with the zod schemas in `src/server/schemas/*` (also used by server
  functions and the UI); services call `parseInput`, which throws a 400.
- Errors are `HttpError`s from `src/server/errors.ts`. better-auth `APIError`s are translated
  by `authCall`.
- Every write happens in one transaction that also writes the audit row (`recordAudit`)
  and publishes the cache invalidation event (`publish`). Calls into better-auth are
  not part of that transaction; their audit rows are written right after.
- Changes that leave a configuration untouched are not written: no version bump, no audit
  row, no invalidation.
- A project's audit log is removed together with the project, so `deleteProject` does not
  write an audit entry.
