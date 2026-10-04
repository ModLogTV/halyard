import { createInstance, type i18n } from 'i18next'
import { namespaces, resources } from '@/locales'

export const SUPPORTED_LOCALES = ['en', 'de'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
/** Cookie that pins the UI language. Readable by the client so navigations resolve it without a round trip. */
export const LOCALE_COOKIE = 'halyard_locale'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Pick the UI language from the cookie first, then the best `Accept-Language` match, then English. */
export function resolveLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookie)) return cookie
  for (const candidate of parseAcceptLanguage(acceptLanguage)) {
    const base = candidate.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

/** `de-DE,de;q=0.9,en;q=0.8` -> `['de-DE', 'de', 'en']`, ordered by quality. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const quality = q ? Number.parseFloat(q.slice(2)) : 1
      return { tag: (tag ?? '').trim(), quality: Number.isFinite(quality) ? quality : 0, index }
    })
    .filter((entry) => entry.tag && entry.tag !== '*' && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((entry) => entry.tag)
}

export function readLocaleCookie(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === LOCALE_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

const instances = new Map<Locale, i18n>()

/**
 * One fully initialised i18next instance per locale. Instances never change
 * language, so sharing them between concurrent server renders is safe. Resources
 * are bundled, which keeps `t()` synchronous during SSR and hydration.
 */
export function getI18n(locale: Locale): i18n {
  const existing = instances.get(locale)
  if (existing) return existing
  const instance = createInstance({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    resources,
    ns: namespaces,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    initAsync: false,
  })
  instance.init()
  instances.set(locale, instance)
  return instance
}

/** Translate outside React, for example in a route's `head()`. Prefix keys with the namespace: `t('auth:signIn.pageTitle')`. */
export function translate(locale: Locale) {
  return getI18n(locale).t
}
