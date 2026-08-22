import { describe, expect, it } from 'vitest'
import { ACCESSORIES, BOARDS, CATALOG } from '../data/catalog'
import { INTL_LOCALE, LANGUAGES } from './index'
import { detectLanguage } from './detect'
import en from './en.json'
import ja from './ja.json'
import zhHant from './zh-Hant.json'

const BUNDLES = { en, ja, 'zh-Hant': zhHant } as const

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child && typeof child === 'object') {
      for (const [k, v] of flatten(child, `${prefix}${key}.`)) out.set(k, v)
    } else {
      out.set(`${prefix}${key}`, String(child))
    }
  }
  return out
}

describe('translation bundles', () => {
  const english = flatten(en)

  // Checked by hand three times while building; now it is checked every run.
  for (const [language, bundle] of Object.entries(BUNDLES)) {
    it(`${language} defines exactly the same keys as English`, () => {
      const keys = new Set(flatten(bundle).keys())
      const missing = [...english.keys()].filter((k) => !keys.has(k))
      const extra = [...keys].filter((k) => !english.has(k))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })

    it(`${language} has no empty strings`, () => {
      const empty = [...flatten(bundle)].filter(([, v]) => v.trim() === '').map(([k]) => k)
      expect(empty).toEqual([])
    })

    it(`${language} is not silently left in English`, () => {
      if (language === 'en') return
      const translated = flatten(bundle)
      const identical = [...english]
        .filter(([key, value]) => translated.get(key) === value && /\s/.test(value))
        .map(([key]) => key)
      // Whole sentences copied verbatim from English mean a missed translation.
      expect(identical).toEqual([])
    })

    it(`${language} keeps interpolation placeholders intact`, () => {
      const translated = flatten(bundle)
      for (const [key, value] of english) {
        const wanted = [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
        const got = [...(translated.get(key) ?? '').matchAll(/\{\{(\w+)\}\}/g)]
          .map((m) => m[1])
          .sort()
        expect(got, key).toEqual(wanted)
      }
    })
  }

  it('offers a selector entry and an Intl locale for every language', () => {
    const ids = LANGUAGES.map((l) => l.id)
    expect(new Set(ids)).toEqual(new Set(Object.keys(BUNDLES)))
    for (const id of ids) {
      expect(INTL_LOCALE[id], id).toBeTruthy()
      expect(() => new Intl.NumberFormat(INTL_LOCALE[id])).not.toThrow()
    }
  })

  it('names every catalog item in every language', () => {
    for (const item of CATALOG) {
      for (const { id } of LANGUAGES) {
        expect(item.names[id]?.trim(), `${item.key}.${id}`).toBeTruthy()
      }
    }
  })

  it('does not reuse one name for two different products in a language', () => {
    for (const { id } of LANGUAGES) {
      for (const group of [BOARDS, ACCESSORIES]) {
        const names = group.map((i) => i.names[id])
        expect(new Set(names).size, `${id} duplicates`).toBe(names.length)
      }
    }
  })
})

describe('detectLanguage', () => {
  it('picks Japanese for a Japanese browser', () => {
    expect(detectLanguage(['ja-JP', 'en-US'])).toBe('ja')
  })

  it('treats Taiwan, Hong Kong and Macau Chinese as Traditional', () => {
    expect(detectLanguage(['zh-TW'])).toBe('zh-Hant')
    expect(detectLanguage(['zh-HK'])).toBe('zh-Hant')
    expect(detectLanguage(['zh-Hant-MO'])).toBe('zh-Hant')
  })

  it('does not claim Simplified Chinese as Traditional', () => {
    // We ship no Simplified bundle, so these must fall through to English
    // rather than showing a zh-Hant reader's UI to a zh-Hans reader.
    expect(detectLanguage(['zh-CN', 'en'])).toBe('en')
    expect(detectLanguage(['zh-Hans', 'en'])).toBe('en')
    expect(detectLanguage(['zh-SG', 'en'])).toBe('en')
  })

  it('honours preference order rather than taking the first match it can serve', () => {
    expect(detectLanguage(['ja', 'en'])).toBe('ja')
    expect(detectLanguage(['en', 'ja'])).toBe('en')
  })

  it('falls back to English for unsupported or absent languages', () => {
    expect(detectLanguage(['de-DE', 'fr-FR'])).toBe('en')
    expect(detectLanguage([])).toBe('en')
  })
})
