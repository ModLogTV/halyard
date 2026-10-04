import { createFileRoute, useRouter } from '@tanstack/react-router'
import { MailIcon, PlusIcon, Trash2Icon, UserMinusIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/settings/confirm-dialog'
import { errorMessage, initials } from '@/components/settings/form-utils'
import { DisabledHint, HintedButton, IconButton } from '@/components/settings/hinted-button'
import { InviteMemberDialog } from '@/components/settings/invite-member-dialog'
import { ROLE_ORDER } from '@/components/settings/roles'
import { SettingsPending, SettingsSection } from '@/components/settings/settings-section'
import { useSettingsContext } from '@/components/settings/use-settings-context'
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
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { translate } from '@/lib/i18n'
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
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('settings:members.pageTitle') }],
  }),
  pendingComponent: () => <SettingsPending rows={4} />,
  component: MembersSettings,
})

function MembersSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const { project, user, isOwner } = useSettingsContext()
  const { members, invitations } = Route.useLoaderData()
  const [inviteOpen, setInviteOpen] = useState(false)
  const ownerCount = members.filter((m) => m.role === 'owner').length

  const inviteButton = (
    <HintedButton
      onClick={() => setInviteOpen(true)}
      disabledReason={isOwner ? undefined : t('shared.ownerOnly')}
    >
      <PlusIcon /> {t('members.invite')}
    </HintedButton>
  )

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title={t('common:labels.members')}
        description={t('members.description', { count: members.length, name: project.name })}
        actions={inviteButton}
      >
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:labels.member')}</TableHead>
                <TableHead className="w-44">{t('common:labels.role')}</TableHead>
                <TableHead className="hidden w-40 md:table-cell">{t('members.joined')}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t('common:labels.actions')}</span>
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
        title={t('members.pending.title')}
        description={t('members.pending.description')}
      >
        {invitations.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MailIcon />
              </EmptyMedia>
              <EmptyTitle>{t('members.pending.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('members.pending.empty.description')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{inviteButton}</EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.email')}</TableHead>
                  <TableHead className="w-28">{t('common:labels.role')}</TableHead>
                  <TableHead className="hidden w-40 md:table-cell">
                    {t('members.pending.invited')}
                  </TableHead>
                  <TableHead className="hidden w-44 md:table-cell">
                    {t('members.pending.expires')}
                  </TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">{t('common:labels.actions')}</span>
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
  const { t, i18n } = useTranslation(['settings', 'common'])
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)

  const roleReason = !isOwner
    ? t('shared.ownerOnly')
    : isLastOwner
      ? t('members.lastOwnerRole')
      : undefined
  const removeReason = !isOwner
    ? t('shared.ownerOnly')
    : isSelf
      ? t('members.selfRemove')
      : isLastOwner
        ? t('members.lastOwnerRemove')
        : undefined

  async function changeRole(role: ProjectRole) {
    if (role === member.role) return
    setPending(true)
    try {
      await updateMemberRole({ data: { projectId, memberId: member.id, role } })
      toast.success(
        t('members.roleChanged', { name: member.name, role: t(`common:roles.${role}`) }),
      )
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error, t('members.roleChangeFailed')))
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
      <SelectTrigger
        size="sm"
        className="w-32"
        aria-label={t('members.roleAria', { name: member.name })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_ORDER.map((role) => (
          <SelectItem key={role} value={role}>
            {t(`common:roles.${role}`)}
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
              {isSelf ? <Badge variant="secondary">{t('members.you')}</Badge> : null}
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
          title={formatDateTime(member.createdAt, i18n.language)}
        >
          {formatRelativeTime(member.createdAt, { locale: i18n.language })}
        </time>
      </TableCell>
      <TableCell className="text-right">
        <IconButton
          label={t('members.removeAria', { name: member.name })}
          className="text-destructive hover:text-destructive"
          disabledReason={removeReason}
          onClick={() => setRemoveOpen(true)}
        >
          <UserMinusIcon />
        </IconButton>
        <ConfirmDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          title={t('members.remove.title', { name: member.name })}
          description={t('members.remove.description', { name: member.name })}
          confirmLabel={t('members.remove.confirm')}
          onConfirm={async () => {
            await removeMember({ data: { projectId, memberId: member.id } })
            toast.success(t('members.remove.removed', { name: member.name }))
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
  const { t, i18n } = useTranslation(['settings', 'common'])
  const router = useRouter()
  const [cancelOpen, setCancelOpen] = useState(false)

  return (
    <TableRow>
      <TableCell className="font-medium">{invitation.email}</TableCell>
      <TableCell>
        <Badge variant="outline">{t(`common:roles.${invitation.role}`)}</Badge>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <time
          dateTime={new Date(invitation.createdAt).toISOString()}
          title={formatDateTime(invitation.createdAt, i18n.language)}
        >
          {formatRelativeTime(invitation.createdAt, { locale: i18n.language })}
        </time>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        <time
          dateTime={new Date(invitation.expiresAt).toISOString()}
          title={formatDateTime(invitation.expiresAt, i18n.language)}
        >
          {formatDateTime(invitation.expiresAt, i18n.language)}
        </time>
      </TableCell>
      <TableCell className="text-right">
        <IconButton
          label={t('members.pending.cancelAria', { email: invitation.email })}
          className="text-destructive hover:text-destructive"
          disabledReason={isOwner ? undefined : t('shared.ownerOnly')}
          onClick={() => setCancelOpen(true)}
        >
          <Trash2Icon />
        </IconButton>
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title={t('members.pending.cancelTitle', { email: invitation.email })}
          description={t('members.pending.cancelDescription')}
          confirmLabel={t('members.pending.cancelConfirm')}
          cancelLabel={t('members.pending.keep')}
          onConfirm={async () => {
            await cancelInvitation({ data: { projectId, invitationId: invitation.id } })
            toast.success(t('members.pending.canceled'))
            await router.invalidate()
          }}
        />
      </TableCell>
    </TableRow>
  )
}
