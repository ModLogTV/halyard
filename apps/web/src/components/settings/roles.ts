import type { ProjectRole } from '@/lib/permissions'

export const ROLE_INFO: Record<ProjectRole, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Manages everything, including settings and members.' },
  editor: {
    label: 'Editor',
    description: 'Changes flags, segments, experiments and schedules.',
  },
  viewer: { label: 'Viewer', description: 'Reads and uses the playground.' },
}

export const ROLE_ORDER: ProjectRole[] = ['owner', 'editor', 'viewer']
