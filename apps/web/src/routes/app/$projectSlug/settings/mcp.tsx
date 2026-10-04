import { createFileRoute, Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { McpConnectionGuide } from '@/components/mcp/connection-guide'
import { isManagementKey, KEY_PLACEHOLDER } from '@/components/mcp/snippets'
import { CopyButton } from '@/components/settings/copy-button'
import { HintedButton } from '@/components/settings/hinted-button'
import { SettingsSection } from '@/components/settings/settings-section'
import { useSettingsContext } from '@/components/settings/use-settings-context'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { translate } from '@/lib/i18n'

/** Shown until the browser origin is known (the page is server rendered). */
const FALLBACK_ORIGIN = 'https://halyard.example.com'

export const Route = createFileRoute('/app/$projectSlug/settings/mcp')({
  staticData: { crumbKey: 'mcp' },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('settings:mcp.pageTitle') }],
  }),
  component: McpSettings,
})

function McpSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const { project, isOwner } = useSettingsContext()
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN)
  useEffect(() => setOrigin(window.location.origin), [])
  const [key, setKey] = useState('')

  const url = `${origin}/mcp`
  const trimmed = key.trim()
  const keyError = trimmed && !isManagementKey(trimmed) ? t('mcp.key.invalid') : undefined

  const createKey = isOwner ? (
    <Button asChild variant="outline">
      <Link
        to="/app/$projectSlug/settings/api-keys"
        params={{ projectSlug: project.slug }}
        search={{ create: 'management' }}
      >
        <PlusIcon /> {t('apiKeys.management.create')}
      </Link>
    </Button>
  ) : (
    <HintedButton variant="outline" disabledReason={t('shared.ownerOnly')}>
      <PlusIcon /> {t('apiKeys.management.create')}
    </HintedButton>
  )

  return (
    <SettingsSection title={t('mcp.title')} description={t('mcp.description')}>
      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel htmlFor="mcp-url">{t('mcp.url.label')}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="mcp-url"
              readOnly
              value={url}
              className="font-mono"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton value={url} label={t('mcp.url.copy')} />
          </div>
        </Field>

        <Field data-invalid={keyError ? true : undefined}>
          <FieldLabel htmlFor="mcp-key">{t('mcp.key.label')}</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Input
              id="mcp-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="hal_mgmt_…"
              className="min-w-64 flex-1 font-mono"
              aria-invalid={keyError ? true : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            {createKey}
          </div>
          {keyError ? (
            <FieldError>{keyError}</FieldError>
          ) : (
            <FieldDescription>{t('mcp.key.description')}</FieldDescription>
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-sm">{t('mcp.guide.title')}</h3>
          <McpConnectionGuide
            url={url}
            apiKey={trimmed && !keyError ? trimmed : KEY_PLACEHOLDER}
            name={`halyard-${project.slug}`}
          />
          <p className="text-muted-foreground text-sm">{t('mcp.guide.access')}</p>
        </div>
      </FieldGroup>
    </SettingsSection>
  )
}
