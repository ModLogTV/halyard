# MCP server

Halyard serves the [Model Context Protocol](https://modelcontextprotocol.io) at `/mcp`, so AI agents
(Claude Code, Cursor, VS Code and other MCP clients) can read and change flags, segments, experiments and
scheduled changes of a project.

It uses streamable HTTP, is stateless (every replica can answer every request) and speaks both the
2026-07-28 protocol revision and the 2025 revisions most clients still use.

## Connect

The MCP server authenticates with a **management key**, exactly like the [REST API](rest-api.md): create
one under **Settings → API keys → Create management key**. The key decides the project; agents never
pick one.

| Key access | Tools |
| --- | --- |
| Read | read tools only (`get_*`, `list_*`, `evaluate_flags`) |
| Read & write | every tool |

Claude Code:

```sh
claude mcp add --transport http halyard https://flags.example.com/mcp \
  --header "Authorization: Bearer hal_mgmt_xxxxxxxxxxxxxxxx"
```

Clients configured with JSON (Cursor, VS Code, ...):

```json
{
  "mcpServers": {
    "halyard": {
      "url": "https://flags.example.com/mcp",
      "headers": { "Authorization": "Bearer hal_mgmt_xxxxxxxxxxxxxxxx" }
    }
  }
}
```

Clients that only support OAuth (for example claude.ai connectors) cannot connect yet.

## Tools

| Area | Read | Write |
| --- | --- | --- |
| Project | `get_project`, `evaluate_flags`, `list_audit_log` | |
| Flags | `list_flags`, `get_flag` | `create_flag`, `update_flag`, `toggle_flag`, `update_flag_environment`, `promote_flag`, `archive_flag`, `unarchive_flag`, `delete_flag` |
| Segments | `list_segments`, `get_segment` | `create_segment`, `update_segment`, `delete_segment` |
| Experiments | `list_experiments`, `get_experiment` | `create_experiment`, `update_experiment`, `start_experiment`, `stop_experiment`, `delete_experiment` |
| Scheduled changes | `list_scheduled_changes` | `schedule_flag_change`, `schedule_staged_rollout`, `update_scheduled_change`, `cancel_scheduled_change`, `cancel_staged_rollout` |

Each tool describes its input as JSON Schema, and the server sends instructions explaining flags,
environments, rules and rollouts, so agents need no further setup. Tools carry the standard
annotations (`readOnlyHint`, `destructiveHint`), which clients use to ask before running write tools.

- `evaluate_flags` evaluates a context like the playground in the UI does, without recording
  metrics or exposures. Agents can use it to check targeting before and after a change.
- `update_flag_environment` and `toggle_flag` accept `expectedVersion` (the `version` from `get_flag`) and
  fail with `CONFLICT` when the configuration changed in between.
- Failed calls return a tool error with the REST API's `{ "error", "message" }` body, for example
  `NOT_FOUND`, `BAD_REQUEST` or `SEGMENT_IN_USE` (with the rules that use the segment).

## Permissions and audit

A key acts as a project **editor** (read & write) or **viewer** (read), like on the REST API. It cannot
manage environments, members, API keys, webhooks or the project itself; there are no tools for those.

Every change goes through the same services as the UI: validation, one transaction per change, cache
invalidation and an audit log entry attributed to the key (actor type `api_key`, the key's name). Give
each agent its own key so the audit log tells them apart, and revoke the key to cut an agent off.

Browser requests whose `Origin` is not the instance's own (`BETTER_AUTH_URL`) are refused with 403.
