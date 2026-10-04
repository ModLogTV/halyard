import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
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
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function respond(id: string, accept: boolean) {
    setBusy(id)
    try {
      if (accept) await acceptInvitation({ data: { invitationId: id } })
      else await rejectInvitation({ data: { invitationId: id } })
      toast.success(accept ? 'Invitation accepted' : 'Invitation declined')
      await router.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong')
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
                Invited as <span className="capitalize">{inv.role}</span>
                {inv.inviterName ? ` by ${inv.inviterName}` : ''}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="outline"
                size="sm"
                disabled={busy === inv.id}
                onClick={() => respond(inv.id, false)}
              >
                Decline
              </Button>
              <Button size="sm" disabled={busy === inv.id} onClick={() => respond(inv.id, true)}>
                Accept
              </Button>
            </ItemActions>
          </Item>
        </li>
      ))}
    </ul>
  )
}
