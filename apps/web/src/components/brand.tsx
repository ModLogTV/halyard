import { cn } from '@/lib/utils'

export function HalyardMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-6', className)} aria-hidden="true">
      <rect width="64" height="64" rx="14" className="fill-primary" />
      <path d="M20 14v38" stroke="currentColor" className="text-primary-foreground" strokeWidth="4" strokeLinecap="round" />
      <path d="M24 16h22l-6 9 6 9H24z" className="fill-primary-foreground" />
    </svg>
  )
}
