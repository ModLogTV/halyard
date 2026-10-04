import {
  BanIcon,
  MoreHorizontalIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  Trash2Icon,
  UserCheckIcon,
} from 'lucide-react'
import { useState } from 'react'
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
  const [pending, setPending] = useState<Pending>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function run(userId: string, action: () => Promise<unknown>, success: string) {
    setBusyId(userId)
    try {
      await action()
      toast.success(success)
      await onChanged()
    } catch (error) {
      toast.error(message(error, 'Something went wrong'))
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
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Created</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
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
                      <span className="ml-2 font-normal text-muted-foreground text-xs">you</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={admin ? 'default' : 'secondary'}>
                      {admin ? 'Admin' : 'User'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.banned ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="destructive" tabIndex={0}>
                            Banned
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{user.banReason || 'No reason given'}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground text-sm">Active</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right text-muted-foreground"
                    title={formatDateTime(user.createdAt)}
                  >
                    {formatRelativeTime(user.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${user.name}`}
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
                        <TooltipContent>User actions</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
                          {self ? 'This is your account' : user.email}
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
                                ? `${user.name} is no longer an admin`
                                : `${user.name} is now an admin`,
                            )
                          }
                        >
                          {admin ? (
                            <ShieldOffIcon aria-hidden="true" />
                          ) : (
                            <ShieldCheckIcon aria-hidden="true" />
                          )}
                          {admin ? 'Remove admin' : 'Make admin'}
                        </DropdownMenuItem>
                        {user.banned ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                user.id,
                                () => unbanUser({ data: { userId: user.id } }),
                                `${user.name} was unbanned`,
                              )
                            }
                          >
                            <UserCheckIcon aria-hidden="true" />
                            Unban
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={self}
                            onSelect={() => setPending({ kind: 'ban', user })}
                          >
                            <BanIcon aria-hidden="true" />
                            Ban…
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={self}
                          onSelect={() => setPending({ kind: 'delete', user })}
                        >
                          <Trash2Icon aria-hidden="true" />
                          Delete user…
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
      toast.success(`${user.name} was banned`)
      close()
      await onChanged()
    } catch (err) {
      setError(message(err, 'Could not ban the user'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Ban {user?.name}?</DialogTitle>
            <DialogDescription>
              They are signed out immediately and cannot sign in again until unbanned. Their
              projects and data are kept.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ban-reason">Reason</FieldLabel>
            <Textarea
              id="ban-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Optional"
              autoFocus
            />
            <FieldDescription>Shown only to instance admins.</FieldDescription>
          </Field>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? <Spinner /> : null}
              Ban user
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
  const [busy, setBusy] = useState(false)

  return (
    <AlertDialog
      open={user !== null}
      onOpenChange={(open) => (open || busy ? undefined : onClose())}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {user?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the account for {user?.email}, including their sessions and
            project memberships. It cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={async (event) => {
              event.preventDefault()
              if (!user) return
              setBusy(true)
              try {
                await removeUser({ data: { userId: user.id } })
                toast.success(`${user.name} was deleted`)
                onClose()
                await onChanged()
              } catch (err) {
                toast.error(message(err, 'Could not delete the user'))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? <Spinner /> : null}
            Delete user
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
