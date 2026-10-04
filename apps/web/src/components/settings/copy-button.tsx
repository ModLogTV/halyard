import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { IconButton } from './hinted-button'

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
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
      toast.success('Copied')
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.')
    }
  }

  return (
    <IconButton label={label} variant="outline" onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  )
}
