import { DownloadIcon, FileJsonIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnvDot, type EnvironmentLike } from '@/components/env/env-badge'
import { CopyButton } from '@/components/settings/copy-button'
import { errorMessage } from '@/components/settings/form-utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { exportFlagd, exportProject } from '@/server/functions/transfer'
import { downloadText } from './download'

interface FlagdResult {
  environmentKey: string
  text: string
  warnings: string[]
  flagCount: number
}

/** Download the project as a Halyard JSON document, or preview and download one environment for flagd. */
export function ExportCard({
  projectId,
  projectSlug,
  environments,
}: {
  projectId: string
  projectSlug: string
  environments: EnvironmentLike[]
}) {
  const { t } = useTranslation(['settings', 'common'])
  const selectId = useId()
  const [downloading, setDownloading] = useState(false)
  const [environmentKey, setEnvironmentKey] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<FlagdResult | null>(null)

  async function downloadJson() {
    setDownloading(true)
    try {
      const document = await exportProject({ data: { projectId } })
      downloadText(`${projectSlug}-export.json`, `${JSON.stringify(document, null, 2)}\n`)
      toast.success(t('transfer.export.json.downloaded'))
    } catch (error) {
      toast.error(errorMessage(error, t('transfer.export.json.failed')))
    } finally {
      setDownloading(false)
    }
  }

  async function preview(key: string) {
    setEnvironmentKey(key)
    setResult(null)
    setLoading(true)
    try {
      const { flagd, warnings } = await exportFlagd({ data: { projectId, environmentKey: key } })
      setResult({
        environmentKey: key,
        text: `${JSON.stringify(flagd, null, 2)}\n`,
        warnings,
        flagCount: Object.keys(flagd.flags).length,
      })
    } catch (error) {
      toast.error(errorMessage(error, t('transfer.export.flagd.failed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('transfer.export.title')}</CardTitle>
        <CardDescription>{t('transfer.export.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t('transfer.export.json.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('transfer.export.json.description')}</p>
          </div>
          <Button type="button" onClick={downloadJson} disabled={downloading}>
            {downloading ? <Spinner /> : <DownloadIcon />} {t('transfer.export.json.download')}
          </Button>
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t('transfer.export.flagd.title')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('transfer.export.flagd.description')}
            </p>
          </div>
          <Field className="max-w-xs">
            <FieldLabel htmlFor={selectId}>{t('common:labels.environment')}</FieldLabel>
            <Select value={environmentKey} onValueChange={(key) => void preview(key)}>
              <SelectTrigger id={selectId} className="w-full">
                <SelectValue placeholder={t('transfer.export.flagd.environmentPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env.key} value={env.key}>
                    <EnvDot env={env} /> {env.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t('transfer.export.flagd.environmentHint')}</FieldDescription>
          </Field>

          {loading ? (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Spinner /> {t('transfer.export.flagd.preparing')}
            </div>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-3">
              {result.warnings.length > 0 ? (
                <Alert>
                  <FileJsonIcon />
                  <AlertTitle>
                    {t('transfer.export.flagd.notes', { count: result.warnings.length })}
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                      {result.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {t('transfer.export.flagd.flagsExported', { count: result.flagCount })}
                </p>
                <div className="flex items-center gap-2">
                  <CopyButton value={result.text} label={t('transfer.export.flagd.copy')} />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      downloadText(
                        `${projectSlug}-${result.environmentKey}.flagd.json`,
                        result.text,
                      )
                    }
                  >
                    <DownloadIcon /> {t('common:actions.download')}
                  </Button>
                </div>
              </div>
              <section
                aria-label={t('transfer.export.flagd.previewLabel')}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll the preview
                tabIndex={0}
                className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3"
              >
                <pre className="font-mono text-xs">{result.text}</pre>
              </section>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
