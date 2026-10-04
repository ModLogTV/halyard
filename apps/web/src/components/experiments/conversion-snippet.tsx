import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CopyButton } from '@/components/settings/copy-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const FALLBACK_ORIGIN = 'https://halyard.example.com'

export function curlSnippet(origin: string, environmentName: string, event: string): string {
  const body = JSON.stringify({ event, targetingKey: 'user-123' })
  return [
    `curl -X POST ${origin}/api/v1/track \\`,
    `  -H "Authorization: Bearer <sdk key for ${environmentName}>" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${body}'`,
  ].join('\n')
}

export function fetchSnippet(origin: string, environmentName: string, event: string): string {
  return [
    `await fetch('${origin}/api/v1/track', {`,
    `  method: 'POST',`,
    `  headers: {`,
    `    Authorization: 'Bearer <sdk key for ${environmentName}>',`,
    `    'Content-Type': 'application/json',`,
    `  },`,
    `  body: JSON.stringify({ event: ${JSON.stringify(event)}, targetingKey: 'user-123' }),`,
    `})`,
  ].join('\n')
}

function Snippet({ code, label }: { code: string; label: string }) {
  const { t } = useTranslation(['experiments', 'common'])
  return (
    <div className="relative">
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable code block must be keyboard reachable
        tabIndex={0}
        aria-label={label}
        className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <pre className="font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      </section>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} label={t('snippet.copy', { label })} />
      </div>
    </div>
  )
}

export function ConversionSnippetCard({
  projectSlug,
  environmentName,
  conversionEvent,
}: {
  projectSlug: string
  environmentName: string
  conversionEvent: string
}) {
  const { t } = useTranslation(['experiments', 'common'])
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN)
  useEffect(() => setOrigin(window.location.origin), [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('snippet.title')}</CardTitle>
        <CardDescription>
          <Trans
            t={t}
            i18nKey="snippet.description"
            components={[<span key="key" className="font-mono" />]}
          />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs defaultValue="curl">
          <TabsList>
            <TabsTrigger value="curl">cURL</TabsTrigger>
            <TabsTrigger value="fetch">JavaScript</TabsTrigger>
          </TabsList>
          <TabsContent value="curl" className="mt-3">
            <Snippet
              code={curlSnippet(origin, environmentName, conversionEvent)}
              label={t('snippet.curlLabel')}
            />
          </TabsContent>
          <TabsContent value="fetch" className="mt-3">
            <Snippet
              code={fetchSnippet(origin, environmentName, conversionEvent)}
              label={t('snippet.javascriptLabel')}
            />
          </TabsContent>
        </Tabs>
        <p className="text-muted-foreground text-sm">
          <Trans
            t={t}
            i18nKey="snippet.footer"
            values={{ environment: environmentName }}
            components={[
              <Link
                key="api-keys"
                to="/app/$projectSlug/settings/api-keys"
                params={{ projectSlug }}
                className="underline underline-offset-4 hover:text-foreground"
              />,
            ]}
          />
        </p>
      </CardContent>
    </Card>
  )
}
