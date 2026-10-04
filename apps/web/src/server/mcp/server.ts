import { McpServer } from '@modelcontextprotocol/server'
import { apiKeyActor } from '@/server/api/auth'
import type { ManagementPrincipal } from '@/server/auth/api-key'
import { registerTools, type ToolDefinition } from './tools'
import { experimentTools } from './tools/experiments'
import { flagTools } from './tools/flags'
import { projectTools } from './tools/project'
import { scheduleTools } from './tools/schedules'
import { segmentTools } from './tools/segments'

export const MCP_TOOLS: readonly ToolDefinition[] = [
  ...projectTools,
  ...flagTools,
  ...segmentTools,
  ...experimentTools,
  ...scheduleTools,
]

const INSTRUCTIONS = `Halyard is a feature flag service. This connection is scoped to one project; every tool acts on it.

- A project has environments (for example development, staging, production). Call get_project first to learn their keys and which ones are production.
- A flag is defined once (key, type, variants) and configured per environment: enabled, offVariant (served while disabled), rules (evaluated in order, the first match decides) and fallthrough (served when no rule matches).
- Rules and the fallthrough serve either one variant or a sticky percentage rollout whose weights add up to 100.
- Before changing targeting, read the flag with get_flag and pass its version as expectedVersion, so concurrent edits are not overwritten. Check the outcome with evaluate_flags.
- Changes take effect for SDKs immediately and are recorded in the audit log under this key's name. Confirm with the user before changing production environments or deleting anything.
- Read-only keys only see the read tools.`

/** An MCP server acting as the management key `principal` (an editor or viewer of its project). */
export function createHalyardMcpServer(principal: ManagementPrincipal): McpServer {
  const server = new McpServer(
    { name: 'halyard', title: 'Halyard', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  )
  registerTools(server, MCP_TOOLS, {
    actor: apiKeyActor(principal),
    projectId: principal.projectId,
  })
  return server
}
