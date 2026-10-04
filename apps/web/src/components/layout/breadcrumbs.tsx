import { Link, useMatches } from '@tanstack/react-router'
import { Fragment } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

/**
 * Builds breadcrumbs from route matches. Routes opt in by returning
 * `{ crumb: string }` from their loader data or static data.
 */
export function Breadcrumbs({
  projectName,
  projectSlug,
}: {
  projectName: string
  projectSlug: string
}) {
  const matches = useMatches()
  const crumbs = matches
    .filter((m) => m.pathname.startsWith(`/app/${projectSlug}/`))
    .map((m) => {
      const data = m.loaderData as { crumb?: string } | undefined
      const stat = m.staticData as { crumb?: string } | undefined
      const crumb = data?.crumb ?? stat?.crumb
      return crumb ? { id: m.id, pathname: m.pathname, crumb } : null
    })
    .filter((c): c is { id: string; pathname: string; crumb: string } => c !== null)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {crumbs.length === 0 ? (
            <BreadcrumbPage>{projectName}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link to="/app/$projectSlug" params={{ projectSlug }}>
                {projectName}
              </Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {crumbs.map((c, i) => (
          <Fragment key={c.id}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage>{c.crumb}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={c.pathname}>{c.crumb}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
