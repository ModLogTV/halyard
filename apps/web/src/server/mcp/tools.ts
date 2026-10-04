import type { CallToolResult, McpServer, ToolAnnotations } from '@modelcontextprotocol/server'
import type { z } from 'zod'
import type { ProjectActor } from '@/server/auth/session'
import { HttpError } from '@/server/errors'

export interface ToolContext {
  actor: ProjectActor
  projectId: string
}

/** `read` tools are offered to every key, the others only to keys with write access. */
export type ToolKind = 'read' | 'create' | 'update' | 'delete'

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string
  title: string
  description: string
  kind: ToolKind
  input: S
  run(input: z.output<S>, context: ToolContext): Promise<unknown>
}

export const defineTool = <S extends z.ZodObject>(tool: ToolDefinition<S>): ToolDefinition<S> =>
  tool

const ANNOTATIONS: Record<ToolKind, ToolAnnotations> = {
  read: { readOnlyHint: true, openWorldHint: false },
  create: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  update: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  delete: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
}

const jsonResult = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  ...(isError && { isError: true }),
})

/**
 * Turns a thrown error into a tool error the agent can act on: the same
 * `{ error, message, ... }` body the REST API answers with, and nothing about
 * unexpected errors.
 */
export async function toolError(error: unknown): Promise<CallToolResult> {
  if (error instanceof HttpError) return jsonResult(await error.toResponse().json(), true)
  console.error(error)
  return jsonResult({ error: 'INTERNAL', message: 'Internal server error' }, true)
}

/** Registers `tools` on `server`, acting as `context.actor`. */
export function registerTools(
  server: McpServer,
  tools: readonly ToolDefinition[],
  context: ToolContext,
): void {
  const canWrite = context.actor.role !== 'viewer'
  for (const tool of tools) {
    if (tool.kind !== 'read' && !canWrite) continue
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { title: tool.title, ...ANNOTATIONS[tool.kind] },
      },
      async (input) => {
        try {
          return jsonResult(await tool.run(input, context))
        } catch (error) {
          return toolError(error)
        }
      },
    )
  }
}
