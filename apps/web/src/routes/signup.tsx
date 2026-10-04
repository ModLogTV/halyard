import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AuthShell } from '@/components/auth/auth-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { authClient } from '@/lib/auth-client'
import { translate } from '@/lib/i18n'
import { getSession } from '@/server/functions/session'
import { getSignupPolicy } from '@/server/functions/signup'

export const Route = createFileRoute('/signup')({
  beforeLoad: async () => {
    const session = await getSession()
    if (session) throw redirect({ to: '/app' })
  },
  loader: () => getSignupPolicy(),
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('auth:signUp.pageTitle') }],
  }),
  component: SignupPage,
})

function SignupPage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const policy = Route.useLoaderData()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    if (password.length < 8) {
      setError(t('signUp.passwordTooShort'))
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
      setError(error.message ?? t('signUp.failed'))
      return
    }
    toast.success(t('signUp.success'))
    await navigate({ to: '/app' })
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t('signUp.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('signUp.description')}</p>
      </div>
      {policy.bootstrap ? (
        <Alert className="mb-6">
          <AlertTitle>{t('signUp.bootstrap.title')}</AlertTitle>
          <AlertDescription>{t('signUp.bootstrap.description')}</AlertDescription>
        </Alert>
      ) : policy.mode === 'invite' ? (
        <Alert className="mb-6">
          <AlertTitle>{t('signUp.inviteOnly.title')}</AlertTitle>
          <AlertDescription>{t('signUp.inviteOnly.description')}</AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">{t('common:labels.name')}</FieldLabel>
            <Input id="name" name="name" autoComplete="name" required autoFocus />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">{t('common:labels.email')}</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t('common:labels.password')}</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
            <FieldDescription>{t('signUp.passwordHint')}</FieldDescription>
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Field>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? <Spinner /> : null}
              {t('common:actions.signUp')}
            </Button>
            <FieldDescription className="text-center">
              <Trans
                t={t}
                i18nKey="signUp.haveAccount"
                components={[
                  <Link key="login" to="/login" className="underline underline-offset-4" />,
                ]}
              />
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
