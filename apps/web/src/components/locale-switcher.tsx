import { useRouter } from '@tanstack/react-router'
import { LanguagesIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale, SUPPORTED_LOCALES } from '@/lib/i18n'
import { setLocale as persistLocale } from '@/server/functions/locale'

/** The current UI language and a setter that persists it and re-renders the app. */
export function useLocale() {
  const { i18n } = useTranslation()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const locale: Locale = isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE

  async function setLocale(next: Locale) {
    if (next === locale || pending) return
    setPending(true)
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
      await persistLocale({ data: { locale: next } })
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  return { locale, setLocale, pending }
}

/** Radio items for a dropdown menu, for example the account menu. */
export function LocaleMenuItems() {
  const { t } = useTranslation()
  const { locale, setLocale } = useLocale()
  return (
    <DropdownMenuRadioGroup
      value={locale}
      onValueChange={(value) => {
        if (isLocale(value)) void setLocale(value)
      }}
    >
      {SUPPORTED_LOCALES.map((code) => (
        <DropdownMenuRadioItem key={code} value={code}>
          {t(`languages.${code}`)}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** Compact language select for pages without an account menu, such as sign in. */
export function LocaleSelect({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { locale, setLocale } = useLocale()
  return (
    <Select
      value={locale}
      onValueChange={(value) => {
        if (isLocale(value)) void setLocale(value)
      }}
    >
      <SelectTrigger size="sm" className={className} aria-label={t('labels.language')}>
        <LanguagesIcon />
        <SelectValue>{t(`languages.${locale}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {SUPPORTED_LOCALES.map((code) => (
          <SelectItem key={code} value={code}>
            {t(`languages.${code}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
