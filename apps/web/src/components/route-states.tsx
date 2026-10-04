import { Link, useRouter } from '@tanstack/react-router'
import { AlertTriangleIcon, CompassIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

export function DefaultPending() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80" />
      <div className="mt-4 grid gap-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}

export function DefaultErrorComponent({ error }: { error: unknown }) {
  const { t } = useTranslation('common')
  const message = error instanceof Error ? error.message : String(error)
  const router = useRouter()
  return (
    <Empty className="min-h-[50vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangleIcon />
        </EmptyMedia>
        <EmptyTitle>{t('errors.errorTitle')}</EmptyTitle>
        <EmptyDescription className="max-w-md font-mono text-xs break-words">
          {message}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => router.invalidate()}>{t('actions.tryAgain')}</Button>
      </EmptyContent>
    </Empty>
  )
}

export function DefaultNotFound() {
  const { t } = useTranslation('layout')
  return (
    <Empty className="min-h-[50vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CompassIcon />
        </EmptyMedia>
        <EmptyTitle>{t('routeStates.notFoundTitle')}</EmptyTitle>
        <EmptyDescription>{t('routeStates.notFoundDescription')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link to="/">{t('routeStates.goHome')}</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
