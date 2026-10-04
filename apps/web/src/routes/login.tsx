import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { authClient } from '@/lib/auth-client'
import { translate } from '@/lib/i18n'
import { getSession } from '@/server/functions/session'

/** Only same-origin relative paths are accepted as post-login destinations. */
const safePath = z
  .string()
  .refine((v) => v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\'))
  .optional()
  .catch(undefined)

const searchSchema = z.object({ redirect: safePath })

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const session = await getSession()
    if (session) throw redirect({ to: search.redirect ?? '/app' })
  },
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('auth:signIn.pageTitle') }],
  }),
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    const { error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    setPending(false)
    if (error) {
      setError(error.message ?? 'Sign in failed')
      return
    }
    toast.success('Signed in')
    await navigate({ to: redirectTo ?? '/app' })
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the email and password of your Halyard account.
        </p>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Field>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? <Spinner /> : null}
              Sign in
            </Button>
            <FieldDescription className="text-center">
              New here?{' '}
              <Link to="/signup" className="underline underline-offset-4">
                Create an account
              </Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
