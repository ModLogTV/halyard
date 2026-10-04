import { createFileRoute, getRouteApi, redirect, useRouter } from '@tanstack/react-router'
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, UsersIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { FirstAdminNote, UsersTable } from '@/components/admin'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { listUsers } from '@/server/functions/admin'

const appRoute = getRouteApi('/app')

const PAGE_SIZE = 25

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
})

export const Route = createFileRoute('/app/admin')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!context.user.isAdmin) throw redirect({ to: '/app' })
  },
  loaderDeps: ({ search }) => ({ q: search.q, page: search.page ?? 1 }),
  loader: async ({ deps }) =>
    listUsers({
      data: { search: deps.q, limit: PAGE_SIZE, offset: (deps.page - 1) * PAGE_SIZE },
    }),
  head: () => ({ meta: [{ title: 'Instance admin · Halyard' }] }),
  pendingComponent: AdminPending,
  component: AdminPage,
})

function AdminPending() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-9 w-72" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}

function AdminPage() {
  const { users, total } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const { user: me } = appRoute.useRouteContext()
  const page = search.page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const [query, setQuery] = useState(search.q ?? '')
  useEffect(() => setQuery(search.q ?? ''), [search.q])
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed === (search.q ?? '')) return
    const timer = setTimeout(
      () => navigate({ search: trimmed ? { q: trimmed } : {}, replace: true }),
      300,
    )
    return () => clearTimeout(timer)
  }, [query, search.q, navigate])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageHeader title="Instance admin" description="All accounts on this Halyard instance." />

      <div className="relative w-full max-w-sm">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by email"
          aria-label="Search accounts by email"
          className="pl-8"
        />
      </div>

      {users.length === 0 ? (
        <Empty className="rounded-lg border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>{search.q ? 'No matching accounts' : 'No accounts'}</EmptyTitle>
            <EmptyDescription>
              {search.q ? `No email contains "${search.q}".` : 'Nobody has signed up yet.'}
            </EmptyDescription>
          </EmptyHeader>
          {search.q ? (
            <EmptyContent>
              <Button variant="outline" onClick={() => navigate({ search: {}, replace: true })}>
                Clear search
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <UsersTable users={users} currentUserId={me.id} onChanged={() => router.invalidate()} />
      )}

      {total > PAGE_SIZE ? (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <p className="text-muted-foreground text-sm">
            Page {page} of {pageCount} · {total} accounts
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() =>
                navigate({ search: (prev) => ({ ...prev, page: page - 1 || undefined }) })
              }
            >
              <ChevronLeftIcon /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => navigate({ search: (prev) => ({ ...prev, page: page + 1 }) })}
            >
              Next <ChevronRightIcon />
            </Button>
          </div>
        </nav>
      ) : null}

      <FirstAdminNote />
    </div>
  )
}
