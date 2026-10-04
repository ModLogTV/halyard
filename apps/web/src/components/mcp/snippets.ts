import { MANAGEMENT_KEY_PREFIX } from '@/lib/key-prefixes'

/** MCP clients the connection guide has a snippet for, in tab order. */
export const MCP_CLIENTS = [
  'claudeCode',
  'claudeDesktop',
  'codex',
  'cursor',
  'vscode',
  'gemini',
  'windsurf',
] as const
export type McpClient = (typeof MCP_CLIENTS)[number]

/** Product names, not translated. */
export const MCP_CLIENT_LABELS: Record<McpClient, string> = {
  claudeCode: 'Claude Code',
  claudeDesktop: 'Claude Desktop',
  codex: 'Codex',
  cursor: 'Cursor',
  vscode: 'VS Code',
  gemini: 'Gemini CLI',
  windsurf: 'Windsurf',
}

/** Shown in the snippets until a key is pasted. */
export const KEY_PLACEHOLDER = 'YOUR_MANAGEMENT_KEY'

const MANAGEMENT_KEY_PATTERN = new RegExp(`^${MANAGEMENT_KEY_PREFIX}[A-Za-z0-9_-]+$`)

/** Whether `value` looks like a management key (and is safe to put into a shell command). */
export const isManagementKey = (value: string): boolean => MANAGEMENT_KEY_PATTERN.test(value)

export interface McpSnippetOptions {
  /** The MCP endpoint, for example `https://flags.example.com/mcp`. */
  url: string
  key: string
  /** Name of the server in the client's configuration. */
  name: string
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** mcp-remote refuses plain http except for localhost unless told otherwise. */
function needsAllowHttp(url: string): boolean {
  const { protocol, hostname } = new URL(url)
  return protocol === 'http:' && hostname !== 'localhost' && hostname !== '127.0.0.1'
}

/** A copy-paste ready configuration that connects `client` to the Halyard MCP server. */
export function mcpSnippet(client: McpClient, { url, key, name }: McpSnippetOptions): string {
  const authorization = `Bearer ${key}`
  const headers = { Authorization: authorization }
  switch (client) {
    case 'claudeCode':
      return `claude mcp add --transport http ${name} ${url} \\\n  --header "Authorization: ${authorization}"`
    case 'claudeDesktop':
      // Claude Desktop only starts local servers; mcp-remote bridges to the HTTP endpoint.
      return json({
        mcpServers: {
          [name]: {
            command: 'npx',
            args: [
              '-y',
              'mcp-remote',
              url,
              '--header',
              // biome-ignore lint/suspicious/noTemplateCurlyInString: mcp-remote expands the variable from `env`
              'Authorization:${HALYARD_AUTHORIZATION}',
              ...(needsAllowHttp(url) ? ['--allow-http'] : []),
            ],
            env: { HALYARD_AUTHORIZATION: authorization },
          },
        },
      })
    case 'codex':
      return [
        `[mcp_servers.${name}]`,
        `url = ${JSON.stringify(url)}`,
        `http_headers = { "Authorization" = ${JSON.stringify(authorization)} }`,
      ].join('\n')
    case 'cursor':
      return json({ mcpServers: { [name]: { url, headers } } })
    case 'vscode':
      return json({ servers: { [name]: { type: 'http', url, headers } } })
    case 'gemini':
      return json({ mcpServers: { [name]: { httpUrl: url, headers } } })
    case 'windsurf':
      return json({ mcpServers: { [name]: { serverUrl: url, headers } } })
  }
}
