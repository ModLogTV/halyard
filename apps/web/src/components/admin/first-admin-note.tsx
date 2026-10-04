import { ShieldCheckIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** Explains how the first instance admin is created, since sign-up never grants admin. */
export function FirstAdminNote() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4" aria-hidden="true" />
          Creating the first admin
        </CardTitle>
        <CardDescription>
          Accounts are created with the user role. An existing admin can promote others from the
          table above; the very first admin is set directly in the database.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>Sign up, then run this against the Halyard database:</p>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
          <code>{`update "user" set role = 'admin' where email = 'you@example.com';`}</code>
        </pre>
        <p className="text-muted-foreground">
          Sign out and back in to pick up the new role. Seeded development databases already include{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">admin@example.com</code>{' '}
          as an admin.
        </p>
      </CardContent>
    </Card>
  )
}
