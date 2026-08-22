/**
 * UI translations. Deliberately independent of the price market: a user in
 * Taiwan reads Traditional Chinese while pricing against IKEA US or their own
 * custom prices. See findings.md F4 for why that split exists.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { LanguageId } from '../data/catalog'
import en from './en.json'
import ja from './ja.json'
import zhHant from './zh-Hant.json'

export const LANGUAGES: ReadonlyArray<{ id: LanguageId; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'zh-Hant', label: '繁體中文' },
]

/** BCP 47 tags for Intl currency and number formatting. */
export const INTL_LOCALE: Record<LanguageId, string> = {
  en: 'en-US',
  ja: 'ja-JP',
  'zh-Hant': 'zh-Hant-TW',
}

export { detectLanguage } from './detect'

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
    'zh-Hant': { translation: zhHant },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
