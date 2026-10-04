import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { authClient } from '@/lib/auth-client'
import { getSession } from '@/server/functions/session'

export const Route = createFileRoute('/signup')({
  beforeLoad: async () => {
    const session = await getSession()
    if (session) throw redirect({ to: '/app' })
  },
  head: () => ({ meta: [{ title: 'Create account · Halyard' }] }),
  component: SignupPage,
})

function SignupPage() {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setPending(true)
    setError(null)
    const { error } = await authClient.signUp.email({
      name: String(form.get('name')),
      email: String(form.get('email')),
      password,
    })
    setPending(false)
    if (error) {
      setError(error.message ?? 'Sign up failed')
      return
    }
    toast.success('Account created')
    await navigate({ to: '/app' })
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You can create a project right after signing up.
        </p>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" name="name" autoComplete="name" required autoFocus />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
            <FieldDescription>At least 8 characters.</FieldDescription>
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Field>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? <Spinner /> : null}
              Create account
            </Button>
            <FieldDescription className="text-center">
              Already have an account?{' '}
              <Link to="/login" className="underline underline-offset-4">
                Sign in
              </Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
