import { updateEnvironment } from '@/server/services/environments'
import { archiveFlag, createFlag, updateFlagEnvironment } from '@/server/services/flags'
import { createSegment } from '@/server/services/segments'
import type { ProjectFixture } from './factories'

/**
 * Seeds a project through the services: the default environments (staging renamed), two
 * segments and four flags with rules, segment conditions, rollouts and an archived flag.
 */
export async function seedProject(fx: ProjectFixture): Promise<void> {
  const actor = fx.owner.actor
  const projectId = fx.projectId

  await updateEnvironment(actor, {
    projectId,
    environmentId: fx.environmentId('staging'),
    patch: { name: 'Pre-production', color: '#a855f7' },
  })

  await createSegment(actor, {
    projectId,
    key: 'beta-users',
    name: 'Beta users',
    description: 'Opted in to betas',
    conditions: [
      { type: 'attribute', attribute: 'plan', operator: 'eq', value: 'pro' },
      { type: 'attribute', attribute: 'country', operator: 'in', value: ['DE', 'AT'] },
    ],
  })
  await createSegment(actor, {
    projectId,
    key: 'internal',
    name: 'Internal',
    match: 'any',
    conditions: [
      { type: 'attribute', attribute: 'email', operator: 'ends_with', value: '@acme.com' },
      { type: 'attribute', attribute: 'role', operator: 'exists' },
    ],
  })

  await createFlag(actor, {
    projectId,
    key: 'checkout',
    name: 'New checkout',
    description: 'The redesigned checkout',
    type: 'boolean',
    tags: ['payments', 'frontend'],
  })
  await updateFlagEnvironment(actor, {
    projectId,
    flagKey: 'checkout',
    environmentKey: 'development',
    patch: { enabled: true },
  })
  await updateFlagEnvironment(actor, {
    projectId,
    flagKey: 'checkout',
    environmentKey: 'production',
    patch: {
      enabled: true,
      rules: [
        {
          description: 'Beta users',
          conditions: [{ type: 'segment', segmentKey: 'beta-users' }],
          serve: { type: 'variant', variant: 'on' },
        },
      ],
      fallthrough: {
        type: 'rollout',
        bucketBy: 'userId',
        variations: [
          { variant: 'on', weight: 20 },
          { variant: 'off', weight: 80 },
        ],
      },
    },
  })

  await createFlag(actor, {
    projectId,
    key: 'plan',
    name: 'Default plan',
    type: 'string',
    variants: [
      { key: 'free', value: 'free', name: 'Free' },
      { key: 'pro', value: 'pro', name: 'Pro' },
      { key: 'team', value: 'team' },
    ],
    offVariant: 'free',
    defaultVariant: 'free',
  })
  await updateFlagEnvironment(actor, {
    projectId,
    flagKey: 'plan',
    environmentKey: 'staging',
    patch: {
      enabled: true,
      rules: [
        {
          conditions: [{ type: 'attribute', attribute: 'country', operator: 'eq', value: 'DE' }],
          serve: { type: 'variant', variant: 'pro' },
        },
        {
          description: 'Everyone but staff',
          conditions: [{ type: 'segment', segmentKey: 'internal', negate: true }],
          serve: { type: 'variant', variant: 'team' },
        },
      ],
    },
  })

  await createFlag(actor, {
    projectId,
    key: 'limits',
    name: 'Upload limit',
    type: 'number',
    variants: [
      { key: 'low', value: 10 },
      { key: 'mid', value: 50 },
      { key: 'high', value: 100 },
    ],
    offVariant: 'low',
    defaultVariant: 'mid',
  })
  await updateFlagEnvironment(actor, {
    projectId,
    flagKey: 'limits',
    environmentKey: 'production',
    patch: {
      enabled: true,
      rules: [
        {
          conditions: [
            { type: 'attribute', attribute: 'seats', operator: 'gte', value: 10 },
            { type: 'attribute', attribute: 'version', operator: 'semver_gte', value: '2.1.0' },
          ],
          serve: { type: 'variant', variant: 'high' },
        },
      ],
      fallthrough: {
        type: 'rollout',
        variations: [
          { variant: 'low', weight: 33.3 },
          { variant: 'mid', weight: 33.3 },
          { variant: 'high', weight: 33.4 },
        ],
      },
    },
  })

  await createFlag(actor, {
    projectId,
    key: 'theme',
    name: 'Theme',
    type: 'json',
    variants: [
      { key: 'light', value: { background: '#fff', accent: 'blue' } },
      { key: 'dark', value: { background: '#000', accent: 'orange' } },
    ],
    offVariant: 'light',
    defaultVariant: 'dark',
  })
  await archiveFlag(actor, { projectId, flagKey: 'theme' })
}
