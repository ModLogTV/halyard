import { createServerFn } from '@tanstack/react-start'
import { getCookie, getRequestHeader, setCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { LOCALE_COOKIE, resolveLocale, SUPPORTED_LOCALES } from '@/lib/i18n'

const ONE_YEAR = 60 * 60 * 24 * 365

/** Resolve the UI language for this request and pin it in a cookie on first visit. */
export const getLocale = createServerFn({ method: 'GET' }).handler(async () => {
  const cookie = getCookie(LOCALE_COOKIE)
  const locale = resolveLocale(cookie, getRequestHeader('accept-language'))
  if (cookie !== locale) {
    try {
      setCookie(LOCALE_COOKIE, locale, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' })
    } catch {
      // Not every call site can write response headers; the client falls back to Accept-Language.
    }
  }
  return locale
})

export const setLocale = createServerFn({ method: 'POST' })
  .validator(z.object({ locale: z.enum(SUPPORTED_LOCALES) }))
  .handler(async ({ data }) => {
    setCookie(LOCALE_COOKIE, data.locale, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' })
    return data.locale
  })
