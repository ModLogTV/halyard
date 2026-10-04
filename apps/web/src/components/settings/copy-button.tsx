import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { IconButton } from './hinted-button'

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation(['settings', 'common'])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(t('common:toasts.copied'))
    } catch {
      toast.error(t('shared.copyFailed'))
    }
  }

  return (
    <IconButton label={label ?? t('common:actions.copy')} variant="outline" onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  )
}
