import type { Locale } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'

const LOCALES: Record<string, Locale> = { en: enUS, de }

/** The date-fns locale matching the UI language, for the shadcn Calendar. */
export function useCalendarLocale(): Locale {
  const { i18n } = useTranslation()
  return LOCALES[i18n.language] ?? enUS
}
