import { describe, expect, it } from 'vitest'
import { isManagementKey, MCP_CLIENTS, mcpSnippet } from '@/components/mcp/snippets'

const options = {
  url: 'https://flags.example.com/mcp',
  key: 'hal_mgmt_abc123',
  name: 'halyard-acme',
}
const headers = { Authorization: 'Bearer hal_mgmt_abc123' }

describe('mcpSnippet', () => {
  it('names the server, the URL and the key in every snippet', () => {
    for (const client of MCP_CLIENTS) {
      const snippet = mcpSnippet(client, options)
      expect(snippet).toContain('halyard-acme')
      expect(snippet).toContain('https://flags.example.com/mcp')
      expect(snippet).toContain('Bearer hal_mgmt_abc123')
    }
  })

  it('emits valid JSON with each client’s keys', () => {
    expect(JSON.parse(mcpSnippet('cursor', options))).toEqual({
      mcpServers: { 'halyard-acme': { url: options.url, headers } },
    })
    expect(JSON.parse(mcpSnippet('vscode', options))).toEqual({
      servers: { 'halyard-acme': { type: 'http', url: options.url, headers } },
    })
    expect(JSON.parse(mcpSnippet('gemini', options))).toEqual({
      mcpServers: { 'halyard-acme': { httpUrl: options.url, headers } },
    })
    expect(JSON.parse(mcpSnippet('windsurf', options))).toEqual({
      mcpServers: { 'halyard-acme': { serverUrl: options.url, headers } },
    })
  })

  it('bridges Claude Desktop through mcp-remote, allowing http only where needed', () => {
    const args = (url: string) =>
      JSON.parse(mcpSnippet('claudeDesktop', { ...options, url })).mcpServers['halyard-acme'].args
    expect(args(options.url)).toEqual([
      '-y',
      'mcp-remote',
      options.url,
      '--header',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal mcp-remote expands
      'Authorization:${HALYARD_AUTHORIZATION}',
    ])
    expect(args('http://localhost:3000/mcp')).not.toContain('--allow-http')
    expect(args('http://flags.internal/mcp')).toContain('--allow-http')
  })

  it('writes the Claude Code command and the Codex table', () => {
    expect(mcpSnippet('claudeCode', options)).toBe(
      'claude mcp add --transport http halyard-acme https://flags.example.com/mcp \\\n  --header "Authorization: Bearer hal_mgmt_abc123"',
    )
    expect(mcpSnippet('codex', options)).toBe(
      [
        '[mcp_servers.halyard-acme]',
        'url = "https://flags.example.com/mcp"',
        'http_headers = { "Authorization" = "Bearer hal_mgmt_abc123" }',
      ].join('\n'),
    )
  })
})

describe('isManagementKey', () => {
  it('accepts management keys only', () => {
    expect(isManagementKey('hal_mgmt_ISZUaaONzy_BT-trml')).toBe(true)
    expect(isManagementKey('hal_sdk_abc')).toBe(false)
    expect(isManagementKey('hal_mgmt_')).toBe(false)
    expect(isManagementKey('hal_mgmt_abc" && rm -rf ~')).toBe(false)
  })
})
