import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
import { getSignupPolicy } from '@/server/functions/signup'

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
  loader: () => getSignupPolicy(),
  head: ({ match }) => ({
    meta: [{ title: translate(match.context.locale)('auth:signIn.pageTitle') }],
  }),
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()
  const policy = Route.useLoaderData()
  const canSignUp = policy.mode === 'open' || policy.bootstrap
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
      setError(error.message ?? t('signIn.failed'))
      return
    }
    toast.success(t('signIn.success'))
    await navigate({ to: redirectTo ?? '/app' })
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t('signIn.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('signIn.description')}</p>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t('common:labels.email')}</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t('common:labels.password')}</FieldLabel>
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
              {t('common:actions.signIn')}
            </Button>
            {canSignUp ? (
              <FieldDescription className="text-center">
                <Trans
                  t={t}
                  i18nKey={policy.bootstrap ? 'signIn.bootstrap' : 'signIn.newHere'}
                  components={[
                    <Link key="signup" to="/signup" className="underline underline-offset-4" />,
                  ]}
                />
              </FieldDescription>
            ) : (
              <FieldDescription className="text-center">{t('signIn.inviteOnly')}</FieldDescription>
            )}
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
