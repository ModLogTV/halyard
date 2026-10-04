import { Link, useMatches } from '@tanstack/react-router'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

/**
 * Builds breadcrumbs from route matches. Routes opt in with
 * `staticData: { crumbKey }` (translated from the `layout` namespace) or by
 * returning `{ crumb: string }` from their loader for dynamic names.
 */
export function Breadcrumbs({
  projectName,
  projectSlug,
}: {
  projectName: string
  projectSlug: string
}) {
  const { t } = useTranslation('layout')
  const matches = useMatches()
  const crumbs = matches
    .filter((m) => m.pathname.startsWith(`/app/${projectSlug}/`))
    .map((m) => {
      const data = m.loaderData as { crumb?: string } | undefined
      const stat = m.staticData as { crumbKey?: string } | undefined
      const crumb =
        data?.crumb ??
        (stat?.crumbKey ? t(`crumbs.${stat.crumbKey}`, { defaultValue: stat.crumbKey }) : undefined)
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
