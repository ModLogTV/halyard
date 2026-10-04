# UI translations

Halyard's interface strings live here, one JSON file per namespace and language.
`en` is the source of truth; `de` mirrors its structure. Missing German keys fall
back to English at runtime, and TypeScript checks every key against `en`.

## Using translations

```tsx
import { useTranslation } from 'react-i18next'

function FlagHeader({ count }: { count: number }) {
  const { t, i18n } = useTranslation(['flags', 'common']) // own namespace first, then shared
  return (
    <>
      <h1>{t('list.title')}</h1>                         // flags.json -> list.title
      <p>{t('common:counts.flags', { count })}</p>       // another namespace, plural aware
      <time>{formatRelativeTime(updatedAt, { locale: i18n.language })}</time>
    </>
  )
}
```

- Namespaces: `common`, `layout`, `auth`, `projects`, `flags`, `segments`, `compare`,
  `playground`, `audit`, `experiments`, `schedules`, `settings`. Call
  `useTranslation(['<namespace>', 'common'])` once per component: keys of the first
  namespace are unprefixed, shared keys are written `common:actions.save`. A key
  prefix only type checks for namespaces listed in that `useTranslation` call.
  Components that only need shared strings can call `useTranslation()`.
- Keys are camelCase and grouped by screen or component, e.g. `detail.status.title`.
  Prefer describing the purpose (`emptyState.description`) over the English text.
- Interpolation: `"Updated {{time}}"` with `t('x', { time })`. Never build sentences by
  concatenating translated fragments; put the whole sentence in one key.
- Plurals: `"rules_one": "{{count}} rule"`, `"rules_other": "{{count}} rules"` and
  `t('rules', { count })`. Do not keep `pluralize()` from `lib/format.ts`.
- Rich text (links, bold inside a sentence): use `<Trans>` from react-i18next with
  numbered placeholders, e.g. `"Read the <0>docs</0>."`.
- Dynamic keys must stay type safe. With a union-typed value,
  `t(\`flagTypes.${type}\`)` type checks. Otherwise map explicitly.
- Route titles run outside React. Use the route context:
  `head: ({ match }) => ({ meta: [{ title: translate(match.context.locale)('auth:signIn.pageTitle') }] })`.
- Dates: `formatDateTime(date, i18n.language)`, `formatRelativeTime(date, { locale: i18n.language })`.
  Numbers: `new Intl.NumberFormat(i18n.language)`.
- Everything a user can read or a screen reader announces is translatable: visible text,
  `placeholder`, `title`, `aria-label`, `aria-description`, tooltip content, toast
  messages, confirmation dialogs, empty and error states, select option labels, chart
  labels, `sr-only` text, document titles, breadcrumb labels (`staticData.crumb`).
- Do not translate: identifiers and keys shown as data (`flag.key`, environment names,
  variant keys, tags, emails), code and JSON samples, URLs, HTTP header names, the
  product name "Halyard", log output, anything coming from the server or the engine.

## Adding a language

Create `src/locales/<code>/*.json` for every namespace, register the language in
`src/locales/index.ts` and `SUPPORTED_LOCALES` in `src/lib/i18n.ts`, and add its
display name to `common.json` under `languages`.
