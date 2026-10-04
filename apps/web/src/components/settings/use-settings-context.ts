import { getRouteApi } from '@tanstack/react-router'

const projectRoute = getRouteApi('/app/$projectSlug')
const appRoute = getRouteApi('/app')

export const OWNER_ONLY_MESSAGE = 'Only owners can change this'

/** The current project, the signed-in user and whether they may change settings. */
export function useSettingsContext() {
  const { project } = projectRoute.useLoaderData()
  const { user } = appRoute.useRouteContext()
  return { project, user, isOwner: project.role === 'owner' }
}
