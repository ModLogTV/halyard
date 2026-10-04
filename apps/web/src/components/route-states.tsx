import { Link, useRouter } from '@tanstack/react-router'
import { AlertTriangleIcon, CompassIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

export function DefaultPending() {
  return (
    <div className="flex flex-col gap-4 p-6" aria-busy="true" aria-label="Loading">
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
  const message = error instanceof Error ? error.message : String(error)
  const router = useRouter()
  return (
    <Empty className="min-h-[50vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangleIcon />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription className="max-w-md font-mono text-xs break-words">{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => router.invalidate()}>Try again</Button>
      </EmptyContent>
    </Empty>
  )
}

export function DefaultNotFound() {
  return (
    <Empty className="min-h-[50vh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CompassIcon />
        </EmptyMedia>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>The page you are looking for does not exist or was moved.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
