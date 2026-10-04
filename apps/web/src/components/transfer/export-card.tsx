import { DownloadIcon, FileJsonIcon } from 'lucide-react'
import { useId, useState } from 'react'
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
import { pluralize } from '@/lib/format'
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
      toast.success('Export downloaded')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not export the project'))
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
      toast.error(errorMessage(error, 'Could not export for flagd'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
        <CardDescription>
          Take this project's environments, segments and flags with their targeting out of Halyard.
          Exports hold no keys, statistics or members.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Halyard JSON</h3>
            <p className="text-sm text-muted-foreground">
              The complete document. Import it into another project or keep it as a backup.
            </p>
          </div>
          <Button type="button" onClick={downloadJson} disabled={downloading}>
            {downloading ? <Spinner /> : <DownloadIcon />} Download JSON
          </Button>
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Export for flagd</h3>
            <p className="text-sm text-muted-foreground">
              One environment as a flagd flag definition file. Anything flagd cannot express exactly
              is listed below.
            </p>
          </div>
          <Field className="max-w-xs">
            <FieldLabel htmlFor={selectId}>Environment</FieldLabel>
            <Select value={environmentKey} onValueChange={(key) => void preview(key)}>
              <SelectTrigger id={selectId} className="w-full">
                <SelectValue placeholder="Choose an environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env.key} value={env.key}>
                    <EnvDot env={env} /> {env.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>flagd definitions describe one environment.</FieldDescription>
          </Field>

          {loading ? (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Spinner /> Preparing the flagd file
            </div>
          ) : null}

          {result ? (
            <div className="flex flex-col gap-3">
              {result.warnings.length > 0 ? (
                <Alert>
                  <FileJsonIcon />
                  <AlertTitle>
                    {pluralize(result.warnings.length, 'note')} for the flagd export
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
                  {pluralize(result.flagCount, 'flag')} exported
                </p>
                <div className="flex items-center gap-2">
                  <CopyButton value={result.text} label="Copy flagd JSON" />
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
                    <DownloadIcon /> Download
                  </Button>
                </div>
              </div>
              <section
                aria-label="flagd JSON preview"
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
