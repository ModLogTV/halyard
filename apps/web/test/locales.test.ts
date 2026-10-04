import { describe, expect, it } from 'vitest'
import { parseAcceptLanguage, resolveLocale } from '@/lib/i18n'
import { namespaces, resources } from '@/locales'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of flatten(value, path)) out.set(k, v)
  }
  return out
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort()

const transTags = (text: string) => [...text.matchAll(/<(\d+)>/g)].map((m) => m[1]).sort()

describe('locale resources', () => {
  for (const ns of namespaces) {
    describe(ns, () => {
      const en = flatten(resources.en[ns] as Tree)
      const de = flatten(resources.de[ns] as Tree)

      it('has no empty English strings', () => {
        const empty = [...en].filter(([, v]) => v.trim() === '').map(([k]) => k)
        expect(empty).toEqual([])
      })

      it('German covers every English key and nothing else', () => {
        const missing = [...en.keys()].filter((k) => !de.has(k))
        const extra = [...de.keys()].filter((k) => !en.has(k))
        expect({ missing, extra }).toEqual({ missing: [], extra: [] })
      })

      it('German keeps the same interpolation placeholders and Trans tags', () => {
        const mismatches: string[] = []
        for (const [key, value] of en) {
          const other = de.get(key)
          if (other === undefined) continue
          if (
            placeholders(value).join() !== placeholders(other).join() ||
            transTags(value).join() !== transTags(other).join()
          ) {
            mismatches.push(key)
          }
        }
        expect(mismatches).toEqual([])
      })
    })
  }
})

describe('resolveLocale', () => {
  it('prefers a valid cookie', () => {
    expect(resolveLocale('de', 'en-US,en;q=0.9')).toBe('de')
  })

  it('ignores an unknown cookie value', () => {
    expect(resolveLocale('fr', 'de-DE,de;q=0.9,en;q=0.8')).toBe('de')
  })

  it('picks the best supported Accept-Language entry by quality', () => {
    expect(resolveLocale(undefined, 'fr-CH, en;q=0.6, de;q=0.8')).toBe('de')
    expect(parseAcceptLanguage('fr-CH, en;q=0.6, de;q=0.8')).toEqual(['fr-CH', 'de', 'en'])
  })

  it('falls back to English', () => {
    expect(resolveLocale(undefined, undefined)).toBe('en')
    expect(resolveLocale(null, 'fr,es;q=0.8')).toBe('en')
  })
})
