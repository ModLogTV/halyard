import type { JsonValue } from '@modlogtv/halyard-engine'
import { useRouter } from '@tanstack/react-router'
import { CircleAlertIcon, EyeIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnvBadge, type EnvironmentLike, envStyle } from '@/components/env/env-badge'
import { HazardBand } from '@/components/env/hazard-band'
import { errorMessage } from '@/components/settings/form-utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { applyImport, previewImport } from '@/server/functions/transfer'
import type { ImportPreview } from '@/server/services/transfer'
import { DiffView, productionImpact } from './diff-view'

interface PreviewState {
  result: ImportPreview
  document: unknown
  prune: boolean
}

const totalChanges = (diff: ImportPreview['diff']) =>
  (['environments', 'segments', 'flags'] as const).reduce(
    (sum, key) => sum + diff[key].create.length + diff[key].update.length + diff[key].delete.length,
    0,
  )

/** Paste or upload a Halyard export, preview what it would change, then apply it. */
export function ImportCard({
  projectId,
  environments,
  canImport,
}: {
  projectId: string
  environments: EnvironmentLike[]
  canImport: boolean
}) {
  const { t } = useTranslation(['settings', 'common'])
  const router = useRouter()
  const textId = useId()
  const fileId = useId()
  const pruneId = useId()
  const [text, setText] = useState('')
  const [prune, setPrune] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [state, setState] = useState<PreviewState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)

  const invalidate = () => {
    setState(null)
    setParseError(null)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    try {
      setText(await file.text())
      invalidate()
    } catch (error) {
      toast.error(errorMessage(error, t('transfer.import.readFailed')))
    }
  }

  async function runPreview() {
    let document: unknown
    try {
      document = JSON.parse(text)
    } catch {
      setState(null)
      setParseError(t('transfer.import.invalidJson'))
      return
    }
    setParseError(null)
    setPreviewing(true)
    try {
      const result = await previewImport({
        data: { projectId, document: document as JsonValue, prune },
      })
      setState({ result, document, prune })
    } catch (error) {
      toast.error(errorMessage(error, t('transfer.import.previewFailed')))
    } finally {
      setPreviewing(false)
    }
  }

  async function runApply() {
    if (!state) return
    setApplying(true)
    try {
      const result = await applyImport({
        data: { projectId, document: state.document as JsonValue, prune: state.prune },
      })
      const changed = totalChanges(result.diff)
      toast.success(
        changed === 0
          ? t('transfer.import.nothingToChange')
          : t('transfer.import.applied', { count: changed }),
      )
      setConfirming(false)
      setText('')
      setState(null)
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error, t('transfer.import.applyFailed')))
    } finally {
      setApplying(false)
    }
  }

  const result = state?.result
  const changed = result ? totalChanges(result.diff) : 0
  const blocked = !result || result.errors.length > 0 || changed === 0
  const impact = result ? productionImpact(result.diff, environments) : null
  const deletions = result
    ? result.diff.flags.delete.length +
      result.diff.segments.delete.length +
      result.diff.environments.delete.length
    : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('transfer.import.title')}</CardTitle>
        <CardDescription>{t('transfer.import.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {canImport ? (
          <>
            <Field>
              <FieldLabel htmlFor={fileId}>{t('transfer.import.fileLabel')}</FieldLabel>
              <Input
                id={fileId}
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  void onFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <FieldDescription>{t('transfer.import.fileHint')}</FieldDescription>
            </Field>
            <Field data-invalid={parseError ? true : undefined}>
              <FieldLabel htmlFor={textId}>{t('transfer.import.documentLabel')}</FieldLabel>
              <Textarea
                id={textId}
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  invalidate()
                }}
                placeholder='{ "version": 1, "environments": [ ... ], "flags": [ ... ] }'
                rows={8}
                spellCheck={false}
                aria-invalid={parseError ? true : undefined}
                className="font-mono text-xs"
              />
              {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}
            </Field>
            <Field orientation="horizontal">
              <Switch
                id={pruneId}
                checked={prune}
                onCheckedChange={(next) => {
                  setPrune(next)
                  invalidate()
                }}
              />
              <FieldContent>
                <FieldLabel htmlFor={pruneId}>{t('transfer.import.pruneLabel')}</FieldLabel>
                <FieldDescription className={prune ? 'text-destructive' : undefined}>
                  {prune ? t('transfer.import.pruneOnHint') : t('transfer.import.pruneOffHint')}
                </FieldDescription>
              </FieldContent>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={runPreview}
                disabled={previewing || text.trim() === ''}
              >
                {previewing ? <Spinner /> : <EyeIcon />} {t('transfer.import.preview')}
              </Button>
            </div>
          </>
        ) : (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>{t('transfer.import.viewerTitle')}</AlertTitle>
            <AlertDescription>{t('transfer.import.viewerDescription')}</AlertDescription>
          </Alert>
        )}

        {result ? (
          <div className="flex flex-col gap-6 border-t pt-6" aria-live="polite">
            {result.errors.length > 0 ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>
                  {t('transfer.import.problems', { count: result.errors.length })}
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                    {result.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            {result.warnings.length > 0 ? (
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>
                  {t('transfer.import.notes', { count: result.warnings.length })}
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
            {result.errors.length === 0 && changed === 0 ? (
              <p className="text-sm text-muted-foreground">{t('transfer.import.noChanges')}</p>
            ) : null}
            <DiffView diff={result.diff} environments={environments} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => setConfirming(true)} disabled={blocked}>
                <UploadIcon /> {t('transfer.import.apply')}
              </Button>
              {changed > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('transfer.import.willBeWritten', { count: changed })}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={(open) => !applying && setConfirming(open)}>
        <AlertDialogContent>
          {impact && impact.environments.length > 0 ? <HazardBand /> : null}
          <AlertDialogHeader>
            <AlertDialogTitle>
              {impact && impact.environments.length > 0
                ? t('transfer.import.confirm.titleProduction')
                : t('transfer.import.confirm.title')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                <p>{t('transfer.import.confirm.description', { count: changed })}</p>
                {impact && impact.environments.length > 0 ? (
                  <p className="flex flex-wrap items-center gap-1.5">
                    {t('transfer.import.confirm.productionAffected')}
                    {impact.environments.map((env) => (
                      <span key={env.key} style={envStyle(env)}>
                        <EnvBadge env={env} />
                      </span>
                    ))}
                  </p>
                ) : null}
                {deletions > 0 ? (
                  <p className="text-destructive">
                    {t('transfer.import.confirm.deletions', { count: deletions })}
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={applying}
              variant={deletions > 0 ? 'destructive' : 'default'}
              onClick={(event) => {
                event.preventDefault()
                void runApply()
              }}
            >
              {applying ? <Spinner /> : null}
              {impact && impact.environments.length > 0
                ? t('transfer.import.confirm.applyProduction')
                : t('transfer.import.apply')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
