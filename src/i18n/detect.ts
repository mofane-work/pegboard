import type { LanguageId } from '../data/catalog'

/**
 * Pick a starting UI language from the browser.
 *
 * Kept free of the i18next runtime so the store can call it at creation time
 * without dragging translation machinery in — and so it is testable directly.
 */
export function detectLanguage(languages: readonly string[] = readNavigatorLanguages()): LanguageId {
  for (const tag of languages) {
    if (tag.startsWith('ja')) return 'ja'
    // zh-TW / zh-HK / zh-MO / zh-Hant-* are Traditional; zh-CN / zh-Hans / zh-SG are not.
    if (/^zh\b/i.test(tag) && !/hans|-cn|-sg/i.test(tag)) return 'zh-Hant'
    if (tag.startsWith('en')) return 'en'
  }
  return 'en'
}

function readNavigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages ?? (navigator.language ? [navigator.language] : [])
}
