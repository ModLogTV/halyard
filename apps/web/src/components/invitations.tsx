import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useRoleLabel } from '@/components/layout/role-label'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { acceptInvitation, rejectInvitation } from '@/server/functions/members'

export interface InvitationView {
  id: string
  organizationName: string
  role: string
  inviterName?: string | null
  expiresAt: Date | string
}

export function InvitationList({ invitations }: { invitations: InvitationView[] }) {
  const { t } = useTranslation(['auth', 'common'])
  const roleLabel = useRoleLabel()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function respond(id: string, accept: boolean) {
    setBusy(id)
    try {
      if (accept) await acceptInvitation({ data: { invitationId: id } })
      else await rejectInvitation({ data: { invitationId: id } })
      toast.success(accept ? t('invitations.accepted') : t('invitations.declined'))
      await router.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common:errors.errorTitle'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ul className="grid gap-2">
      {invitations.map((inv) => (
        <li key={inv.id}>
          <Item variant="outline">
            <ItemContent>
              <ItemTitle>{inv.organizationName}</ItemTitle>
              <ItemDescription>
                <Trans
                  t={t}
                  i18nKey={inv.inviterName ? 'invitations.invitedAsBy' : 'invitations.invitedAs'}
                  values={{ role: roleLabel(inv.role), inviter: inv.inviterName }}
                  components={[<span key="role" />]}
                />
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="outline"
                size="sm"
                disabled={busy === inv.id}
                onClick={() => respond(inv.id, false)}
              >
                {t('invitations.decline')}
              </Button>
              <Button size="sm" disabled={busy === inv.id} onClick={() => respond(inv.id, true)}>
                {t('invitations.accept')}
              </Button>
            </ItemActions>
          </Item>
        </li>
      ))}
    </ul>
  )
}
