import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CopyButton } from '@/components/settings/copy-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  MCP_CLIENT_LABELS,
  MCP_CLIENTS,
  type McpClient,
  type McpSnippetOptions,
  mcpSnippet,
} from './snippets'

/** One copy box with a tab per MCP client; the copy button copies the active snippet. */
export function McpConnectionGuide({
  url,
  apiKey,
  name,
}: Omit<McpSnippetOptions, 'key'> & { apiKey: string }) {
  const { t } = useTranslation(['settings', 'common'])
  const options: McpSnippetOptions = { url, key: apiKey, name }
  const [client, setClient] = useState<McpClient>('claudeCode')
  const label = MCP_CLIENT_LABELS[client]

  return (
    <Tabs
      value={client}
      onValueChange={(value) => setClient(value as McpClient)}
      className="gap-0 overflow-hidden rounded-lg border"
    >
      <div className="flex items-center gap-2 border-b p-1.5">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <TabsList aria-label={t('mcp.guide.clientsLabel')}>
            {MCP_CLIENTS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {MCP_CLIENT_LABELS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <CopyButton
          value={mcpSnippet(client, options)}
          label={t('mcp.guide.copy', { client: label })}
        />
      </div>
      {MCP_CLIENTS.map((id) => (
        <TabsContent key={id} value={id} className="flex min-w-0 flex-col">
          <p className="border-b px-3 py-2 text-muted-foreground text-xs">
            <Trans
              t={t}
              i18nKey={`mcp.clients.${id}`}
              components={[
                <code key="first" className="font-mono" />,
                <code key="second" className="font-mono" />,
              ]}
            />
          </p>
          <section
            aria-label={t('mcp.guide.snippetLabel', { client: MCP_CLIENT_LABELS[id] })}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable
            tabIndex={0}
            className="overflow-x-auto bg-muted/50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <pre className="p-3 font-mono text-xs leading-relaxed">
              <code>{mcpSnippet(id, options)}</code>
            </pre>
          </section>
        </TabsContent>
      ))}
    </Tabs>
  )
}
