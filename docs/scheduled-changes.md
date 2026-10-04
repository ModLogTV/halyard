# Scheduled changes and staged rollouts

A scheduled change applies a partial configuration to one flag in one environment at a
given time: turn it on or off, replace its fallthrough, replace its rules (any
combination). A staged rollout is a series of scheduled changes that gradually raise
the share of traffic receiving one variant.

## Creating

`createScheduledChange` takes the flag, the environment, `scheduledFor` (must be in
the future), the `change` (`{ enabled?, fallthrough?, rules? }`, at least one field)
and an optional note. The change is validated against the flag's current
configuration with the same rules as a direct edit (variants exist, rollout weights add
up to 100, referenced segments exist). Rules get their ids when the change is created.

Permissions: `schedule:create` plus what applying the change needs right now:
`flag:toggle` for a change that only sets `enabled`, `flag:update` otherwise. Viewers
cannot schedule anything; editors and owners can.

`createStagedRollout` takes a `variant` and `steps: [{ percentage, at }]`. Times must
be strictly increasing and the first one in the future; percentages are between 0 and
100. Every step becomes one pending change with the same `planId` and an increasing
`stepIndex`. Each step sets `enabled: true` and a rollout fallthrough:

```json
{
  "type": "rollout",
  "variations": [
    { "variant": "on", "weight": 25 },
    { "variant": "off", "weight": 75 }
  ]
}
```

The rolled-out variant comes first; the remaining percentage is split evenly between
the flag's other variants (in thousandths of a percent, the first ones receive the
rounding remainder). Because the rolled-out variant is always first, users who were
bucketed into it at a lower percentage keep it as the percentage grows. One audit entry
`schedule.staged_rollout_created` describes the whole plan.

## Editing and cancelling

Only `pending` changes can be edited (`updateScheduledChange`: time, change, note) or
cancelled (`cancelScheduledChange`); anything else answers 409. Cancelling one step of
a staged rollout cancels only that step; `cancelPlan` cancels every pending step of a
plan (steps that already ran are kept). Editing needs `schedule:update` (plus the flag
permission when the change is replaced), cancelling needs `schedule:delete`.

Deleting a flag or an environment deletes its scheduled changes.

Audit actions: `schedule.created`, `schedule.staged_rollout_created`,
`schedule.updated`, `schedule.cancelled`, `schedule.plan_cancelled`, and, written by
the scheduler, `schedule.executed` and `schedule.failed`. All of them are also webhook
events.

## Execution

Every replica runs the scheduler (`apps/web/src/server/workers/scheduler.ts`) when
workers are enabled (`ENABLE_WORKERS`). It polls every 15 seconds
(`SCHEDULER_INTERVAL_MS`, in milliseconds) and, debounced, right after any replica
creates, edits or cancels a scheduled change (the `schedule.changed` event). A change
therefore runs at most one polling interval after its time.

Each run (`runDueScheduledChanges`):

1. **Recovers stale claims.** Changes that have been `running` for more than five
   minutes belong to a replica that died between claiming and finishing them; they are
   set back to `pending`.
2. **Claims** up to 20 due changes in one transaction:

   ```sql
   select id from scheduled_changes
   where status = 'pending' and scheduled_for <= now()
   order by scheduled_for, step_index
   limit 20
   for update skip locked
   ```

   marks them `running` and commits. Replicas running at the same time skip each
   other's locked rows and afterwards no longer see them as pending, so every change
   is claimed by exactly one replica.
3. **Applies** the claimed changes one after the other (oldest first, so steps of a
   rollout keep their order) through the regular flags service,
   `updateFlagEnvironment`, as the system actor *Scheduler*. No `expectedVersion` is
   passed: the change is merged over whatever the configuration is at that moment.
   The flag's audit entry (`flag.toggled` / `flag.environment_updated`) records the
   actor as `{ type: 'system', name: 'Scheduler' }`, and the usual cache invalidation
   reaches every replica.
4. **Finishes** each change as `completed` (with `executedAt`) or `failed` (with
   `executedAt` and `error`), for example when a variant it serves was removed from the
   flag in the meantime. A failed step does not stop later steps of the same plan.

If a batch was full, the next batch is processed right away.

Patches set absolute values, so a change that is applied twice (only possible when a
replica stalls for more than five minutes between applying a change and recording it)
has no further effect: the second application leaves the configuration unchanged and
does not bump its version.

### The system user

`flag_environments.updated_by` references a user, so changes applied by the scheduler
are attributed to a reserved user with the id `system` ("Halyard"). The scheduler
creates it on first use. It is banned and has no credentials, so nobody can sign in
with it. It shows up in the instance user list.
