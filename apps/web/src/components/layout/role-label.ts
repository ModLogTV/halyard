import { useTranslation } from 'react-i18next'

const knownRoles = ['owner', 'editor', 'viewer', 'admin', 'user'] as const
type KnownRole = (typeof knownRoles)[number]

const isKnownRole = (role: string): role is KnownRole =>
  (knownRoles as readonly string[]).includes(role)

/** Returns a function that translates a role name, falling back to the raw value for unknown roles. */
export function useRoleLabel() {
  const { t } = useTranslation('common')
  return (role: string) => (isKnownRole(role) ? t(`roles.${role}`) : role)
}
