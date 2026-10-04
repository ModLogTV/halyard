import {
  BanIcon,
  MoreHorizontalIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  Trash2Icon,
  UserCheckIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import {
  type AdminUser,
  banUser,
  removeUser,
  setUserRole,
  unbanUser,
} from '@/server/functions/admin'

export const isAdminRole = (role: string) => role.split(',').includes('admin')

type Pending = { kind: 'ban'; user: AdminUser } | { kind: 'delete'; user: AdminUser } | null

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

/** Accounts table with per-row actions. `onChanged` runs after any successful change. */
export function UsersTable({
  users,
  currentUserId,
  onChanged,
}: {
  users: AdminUser[]
  currentUserId: string
  onChanged: () => void | Promise<void>
}) {
  const { t, i18n } = useTranslation(['projects', 'common'])
  const [pending, setPending] = useState<Pending>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function run(userId: string, action: () => Promise<unknown>, success: string) {
    setBusyId(userId)
    try {
      await action()
      toast.success(success)
      await onChanged()
    } catch (error) {
      toast.error(message(error, t('common:errors.errorTitle')))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common:labels.name')}</TableHead>
              <TableHead>{t('common:labels.email')}</TableHead>
              <TableHead>{t('common:labels.role')}</TableHead>
              <TableHead>{t('common:labels.status')}</TableHead>
              <TableHead className="text-right">{t('common:labels.created')}</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{t('common:labels.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const admin = isAdminRole(user.role)
              const self = user.id === currentUserId
              return (
                <TableRow key={user.id} aria-busy={busyId === user.id}>
                  <TableCell className="font-medium">
                    {user.name}
                    {self ? (
                      <span className="ml-2 font-normal text-muted-foreground text-xs">
                        {t('admin.table.you')}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={admin ? 'default' : 'secondary'}>
                      {admin ? t('common:roles.admin') : t('common:roles.user')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="destructive" tabIndex={0}>
                            {t('admin.table.banned')}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          {user.banReason || t('admin.table.noReason')}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {t('common:states.active')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right text-muted-foreground"
                    title={formatDateTime(user.createdAt, i18n.language)}
                  >
                    {formatRelativeTime(user.createdAt, { locale: i18n.language })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('admin.table.actionsFor', { name: user.name })}
                              disabled={busyId === user.id}
                            >
                              {busyId === user.id ? (
                                <Spinner />
                              ) : (
                                <MoreHorizontalIcon aria-hidden="true" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>{t('admin.table.userActions')}</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
                          {self ? t('admin.table.ownAccount') : user.email}
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                          disabled={self && admin}
                          onSelect={() =>
                            run(
                              user.id,
                              () =>
                                setUserRole({
                                  data: { userId: user.id, role: admin ? 'user' : 'admin' },
                                }),
                              admin
                                ? t('admin.table.noLongerAdmin', { name: user.name })
                                : t('admin.table.nowAdmin', { name: user.name }),
                            )
                          }
                        >
                          {admin ? (
                            <ShieldOffIcon aria-hidden="true" />
                          ) : (
                            <ShieldCheckIcon aria-hidden="true" />
                          )}
                          {admin ? t('admin.table.removeAdmin') : t('admin.table.makeAdmin')}
                        </DropdownMenuItem>
                        {user.banned ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                user.id,
                                () => unbanUser({ data: { userId: user.id } }),
                                t('admin.table.unbanned', { name: user.name }),
                              )
                            }
                          >
                            <UserCheckIcon aria-hidden="true" />
                            {t('admin.table.unban')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={self}
                            onSelect={() => setPending({ kind: 'ban', user })}
                          >
                            <BanIcon aria-hidden="true" />
                            {t('admin.table.ban')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={self}
                          onSelect={() => setPending({ kind: 'delete', user })}
                        >
                          <Trash2Icon aria-hidden="true" />
                          {t('admin.table.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <BanDialog
        user={pending?.kind === 'ban' ? pending.user : null}
        onClose={() => setPending(null)}
        onChanged={onChanged}
      />
      <DeleteUserDialog
        user={pending?.kind === 'delete' ? pending.user : null}
        onClose={() => setPending(null)}
        onChanged={onChanged}
      />
    </>
  )
}

function BanDialog({
  user,
  onClose,
  onChanged,
}: {
  user: AdminUser | null
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const { t } = useTranslation(['projects', 'common'])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setReason('')
    setError(null)
    onClose()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await banUser({ data: { userId: user.id, reason: reason.trim() || undefined } })
      toast.success(t('admin.banDialog.banned', { name: user.name }))
      close()
      await onChanged()
    } catch (err) {
      setError(message(err, t('admin.banDialog.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.banDialog.title', { name: user?.name })}</DialogTitle>
            <DialogDescription>{t('admin.banDialog.description')}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ban-reason">{t('common:labels.reason')}</FieldLabel>
            <Textarea
              id="ban-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t('newProject.form.optionalPlaceholder')}
              autoFocus
            />
            <FieldDescription>{t('admin.banDialog.reasonHint')}</FieldDescription>
          </Field>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? <Spinner /> : null}
              {t('admin.banDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteUserDialog({
  user,
  onClose,
  onChanged,
}: {
  user: AdminUser | null
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const { t } = useTranslation(['projects', 'common'])
  const [busy, setBusy] = useState(false)

  return (
    <AlertDialog
      open={user !== null}
      onOpenChange={(open) => (open || busy ? undefined : onClose())}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.deleteDialog.title', { name: user?.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('admin.deleteDialog.description', { email: user?.email })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('common:actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={async (event) => {
              event.preventDefault()
              if (!user) return
              setBusy(true)
              try {
                await removeUser({ data: { userId: user.id } })
                toast.success(t('admin.deleteDialog.deleted', { name: user.name }))
                onClose()
                await onChanged()
              } catch (err) {
                toast.error(message(err, t('admin.deleteDialog.failed')))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Spinner /> : null}
            {t('admin.deleteDialog.submit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
