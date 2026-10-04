import { createFileRoute, useRouter } from '@tanstack/react-router'
import { MailIcon, PlusIcon, Trash2Icon, UserMinusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/settings/confirm-dialog'
import { errorMessage, initials } from '@/components/settings/form-utils'
import { DisabledHint, HintedButton, IconButton } from '@/components/settings/hinted-button'
import { InviteMemberDialog } from '@/components/settings/invite-member-dialog'
import { ROLE_INFO, ROLE_ORDER } from '@/components/settings/roles'
import { SettingsPending, SettingsSection } from '@/components/settings/settings-section'
import { OWNER_ONLY_MESSAGE, useSettingsContext } from '@/components/settings/use-settings-context'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatRelativeTime, pluralize } from '@/lib/format'
import type { ProjectRole } from '@/lib/permissions'
import {
  cancelInvitation,
  listMembers,
  removeMember,
  updateMemberRole,
} from '@/server/functions/members'
import type { MemberItem, PendingInvitation } from '@/server/services/members'

export const Route = createFileRoute('/app/$projectSlug/settings/members')({
  staticData: { crumbKey: 'members' },
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const projectId = parent.loaderData?.projectId
    if (!projectId) return { members: [], invitations: [] }
    return listMembers({ data: { projectId } })
  },
  head: () => ({ meta: [{ title: 'Members · Halyard' }] }),
  pendingComponent: () => <SettingsPending rows={4} />,
  component: MembersSettings,
})

function MembersSettings() {
  const { project, user, isOwner } = useSettingsContext()
  const { members, invitations } = Route.useLoaderData()
  const [inviteOpen, setInviteOpen] = useState(false)
  const ownerCount = members.filter((m) => m.role === 'owner').length

  const inviteButton = (
    <HintedButton
      onClick={() => setInviteOpen(true)}
      disabledReason={isOwner ? undefined : OWNER_ONLY_MESSAGE}
    >
      <PlusIcon /> Invite member
    </HintedButton>
  )

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="Members"
        description={`${pluralize(members.length, 'person', 'people')} can access ${project.name}.`}
        actions={inviteButton}
      >
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="w-44">Role</TableHead>
                <TableHead className="hidden w-40 md:table-cell">Joined</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  projectId={project.id}
                  isSelf={member.userId === user.id}
                  isOwner={isOwner}
                  isLastOwner={member.role === 'owner' && ownerCount <= 1}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Pending invitations"
        description="Invitations are accepted in the app by the invitee after signing in."
      >
        {invitations.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailIcon />
              </EmptyMedia>
              <EmptyTitle>No pending invitations</EmptyTitle>
              <EmptyDescription>
                Invite a teammate by email. They will see the invitation after signing in with that
                address.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{inviteButton}</EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-28">Role</TableHead>
                  <TableHead className="hidden w-40 md:table-cell">Invited</TableHead>
                  <TableHead className="hidden w-44 md:table-cell">Expires</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => (
                  <InvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    projectId={project.id}
                    isOwner={isOwner}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SettingsSection>

      <InviteMemberDialog projectId={project.id} open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  )
}

function MemberRow({
  member,
  projectId,
  isSelf,
  isOwner,
  isLastOwner,
}: {
  member: MemberItem
  projectId: string
  isSelf: boolean
  isOwner: boolean
  isLastOwner: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)

  const roleReason = !isOwner
    ? OWNER_ONLY_MESSAGE
    : isLastOwner
      ? 'A project needs at least one owner. Make someone else an owner first.'
      : undefined
  const removeReason = !isOwner
    ? OWNER_ONLY_MESSAGE
    : isSelf
      ? 'Use "Leave project" in General settings to remove yourself'
      : isLastOwner
        ? 'A project needs at least one owner'
        : undefined

  async function changeRole(role: ProjectRole) {
    if (role === member.role) return
    setPending(true)
    try {
      await updateMemberRole({ data: { projectId, memberId: member.id, role } })
      toast.success(`${member.name} is now ${ROLE_INFO[role].label.toLowerCase()}`)
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error, 'Could not change the role'))
    } finally {
      setPending(false)
    }
  }

  const select = (
    <Select
      value={member.role}
      onValueChange={(value) => changeRole(value as ProjectRole)}
      disabled={roleReason !== undefined || pending}
    >
      <SelectTrigger size="sm" className="w-32" aria-label={`Role of ${member.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_ORDER.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_INFO[role].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            {member.image ? <AvatarImage src={member.image} alt="" /> : null}
            <AvatarFallback className="text-xs">{initials(member.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              <span className="truncate">{member.name}</span>
              {isSelf ? <Badge variant="secondary">You</Badge> : null}
            </div>
            <div className="truncate text-xs text-muted-foreground">{member.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {roleReason ? <DisabledHint reason={roleReason}>{select}</DisabledHint> : select}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <time
          dateTime={new Date(member.createdAt).toISOString()}
          title={formatDateTime(member.createdAt)}
        >
          {formatRelativeTime(member.createdAt)}
        </time>
      </TableCell>
      <TableCell className="text-right">
        <IconButton
          label={`Remove ${member.name}`}
          className="text-destructive hover:text-destructive"
          disabledReason={removeReason}
          onClick={() => setRemoveOpen(true)}
        >
          <UserMinusIcon />
        </IconButton>
        <ConfirmDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          title={`Remove ${member.name}?`}
          description={`${member.name} loses access to this project right away. You can invite them again later.`}
          confirmLabel="Remove member"
          onConfirm={async () => {
            await removeMember({ data: { projectId, memberId: member.id } })
            toast.success(`${member.name} was removed`)
            await router.invalidate()
          }}
        />
      </TableCell>
    </TableRow>
  )
}

function InvitationRow({
  invitation,
  projectId,
  isOwner,
}: {
  invitation: PendingInvitation
  projectId: string
  isOwner: boolean
}) {
  const router = useRouter()
  const [cancelOpen, setCancelOpen] = useState(false)

  return (
    <TableRow>
      <TableCell className="font-medium">{invitation.email}</TableCell>
      <TableCell>
        <Badge variant="outline">{ROLE_INFO[invitation.role].label}</Badge>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <time
          dateTime={new Date(invitation.createdAt).toISOString()}
          title={formatDateTime(invitation.createdAt)}
        >
          {formatRelativeTime(invitation.createdAt)}
        </time>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <time
          dateTime={new Date(invitation.expiresAt).toISOString()}
          title={formatDateTime(invitation.expiresAt)}
        >
          {formatDateTime(invitation.expiresAt)}
        </time>
      </TableCell>
      <TableCell className="text-right">
        <IconButton
          label={`Cancel invitation for ${invitation.email}`}
          className="text-destructive hover:text-destructive"
          disabledReason={isOwner ? undefined : OWNER_ONLY_MESSAGE}
          onClick={() => setCancelOpen(true)}
        >
          <Trash2Icon />
        </IconButton>
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title={`Cancel the invitation for ${invitation.email}?`}
          description="The invitation stops working. You can send a new one at any time."
          confirmLabel="Cancel invitation"
          cancelLabel="Keep invitation"
          onConfirm={async () => {
            await cancelInvitation({ data: { projectId, invitationId: invitation.id } })
            toast.success('Invitation canceled')
            await router.invalidate()
          }}
        />
      </TableCell>
    </TableRow>
  )
}
