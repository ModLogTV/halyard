import { ShieldCheckIcon } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** Explains how the first instance admin is created, since sign-up never grants admin. */
export function FirstAdminNote() {
  const { t } = useTranslation('projects')
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4" aria-hidden="true" />
          {t('admin.firstAdmin.title')}
        </CardTitle>
        <CardDescription>{t('admin.firstAdmin.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>{t('admin.firstAdmin.step1')}</p>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
          <code>{`update "user" set role = 'admin' where email = 'you@example.com';`}</code>
        </pre>
        <p className="text-muted-foreground">
          <Trans
            t={t}
            i18nKey="admin.firstAdmin.step2"
            components={[
              <code key="email" className="rounded bg-muted px-1 py-0.5 font-mono text-xs" />,
            ]}
          />
        </p>
      </CardContent>
    </Card>
  )
}
