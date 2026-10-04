import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DEFAULT_LOCALE, getI18n, type Locale, readLocaleCookie, resolveLocale } from '@/lib/i18n'
import { getLocale } from '@/server/functions/locale'
import appCss from '../styles.css?url'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // On the server the cookie and Accept-Language decide; in the browser the cookie
  // (set by the server on first visit) is read directly so navigations stay local.
  beforeLoad: async () => ({ locale: await detectLocale() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Halyard' },
      { name: 'description', content: 'Self-hosted feature flags with a modern UI.' },
      { name: 'color-scheme', content: 'light dark' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
})

async function detectLocale(): Promise<Locale> {
  if (typeof document === 'undefined') return getLocale()
  return resolveLocale(readLocaleCookie(document.cookie), navigator.languages.join(','))
}

function useLocaleFromRoute(): Locale {
  return useRouterState({
    select: (state) =>
      (state.matches[0]?.context as { locale?: Locale } | undefined)?.locale ?? DEFAULT_LOCALE,
  })
}

function RootDocument({ children }: { children: ReactNode }) {
  const locale = useLocaleFromRoute()
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh antialiased">
        <I18nextProvider i18n={getI18n(locale)}>
          <ThemeProvider>
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            <Toaster richColors position="bottom-right" />
          </ThemeProvider>
        </I18nextProvider>
        <Scripts />
      </body>
    </html>
  )
}
