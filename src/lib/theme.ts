/**
 * Bridges CSS theme tokens out to the things that cannot read them directly:
 * three.js, and the browser chrome's `theme-color`.
 *
 * The 3D scene must theme with the page, so colours have exactly one source of
 * truth: the custom properties in `styles/tokens.css`. Nothing here hard-codes
 * a hex value.
 */

import { useEffect, useState } from 'react'

export const SCENE_TOKENS = [
  '--scene-bg',
  '--board-color',
  '--accessory-color',
  '--snap-ok',
  '--snap-bad',
  '--selected-color',
  '--color-accent',
] as const

export type SceneToken = (typeof SCENE_TOKENS)[number]
export type ThemeTokens = Record<SceneToken, string>

/**
 * The scene colours a user is allowed to repaint.
 *
 * A deliberate subset of SCENE_TOKENS: `--snap-ok` and `--snap-bad` say whether
 * a drop is legal, so they are meaning rather than decoration and stay out of
 * the picker.
 */
export const CUSTOMIZABLE_TOKENS = [
  '--scene-bg',
  '--board-color',
  '--accessory-color',
  '--selected-color',
] as const

export type CustomizableToken = (typeof CUSTOMIZABLE_TOKENS)[number]
export type ColorOverrides = Partial<Record<CustomizableToken, string>>

/**
 * Six-digit hex only.
 *
 * These values are written straight into a CSS custom property, and `migrate`
 * is skipped when the persisted version already matches — so a hand-edited
 * localStorage blob reaches this unchecked. Anything that is not a literal
 * colour is refused rather than sanitised.
 */
const HEX = /^#[0-9a-fA-F]{6}$/

export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/**
 * The theme's own values for the customizable tokens, with any override
 * ignored — what a Reset would go back to.
 *
 * Reads them by lifting the inline overrides off and putting them straight
 * back. Both writes happen in one task, so nothing is painted in between; and
 * because `useThemeTokens` compares before it re-renders, the pair costs a
 * style read rather than a scene rebuild.
 */
export function readThemeDefaults(): Record<CustomizableToken, string> {
  const root = document.documentElement
  const saved = CUSTOMIZABLE_TOKENS.map(
    (token) => [token, root.style.getPropertyValue(token)] as const,
  )
  for (const [token] of saved) root.style.removeProperty(token)

  const styles = getComputedStyle(root)
  const defaults = {} as Record<CustomizableToken, string>
  for (const token of CUSTOMIZABLE_TOKENS) {
    defaults[token] = styles.getPropertyValue(token).trim() || FALLBACK_COLOR
  }

  for (const [token, value] of saved) {
    if (value) root.style.setProperty(token, value)
  }
  return defaults
}

/**
 * Writes the user's overrides onto the root element as inline custom
 * properties, so they sit above whatever the theme defined. Tokens with no
 * override are removed rather than left behind, which is what makes Reset and
 * a theme change fall back to tokens.css.
 */
export function applyColors(colors: ColorOverrides): void {
  const root = document.documentElement
  for (const token of CUSTOMIZABLE_TOKENS) {
    const value = colors[token]
    if (isValidColor(value)) root.style.setProperty(token, value)
    else root.style.removeProperty(token)
  }
}

/** Shown when a token resolves to nothing at all, which should not happen. */
export const FALLBACK_COLOR = '#888888'

function readTokens(): ThemeTokens {
  const styles = getComputedStyle(document.documentElement)
  const tokens = {} as ThemeTokens
  for (const token of SCENE_TOKENS) {
    tokens[token] = styles.getPropertyValue(token).trim() || FALLBACK_COLOR
  }
  return tokens
}

function sameTokens(a: ThemeTokens, b: ThemeTokens): boolean {
  return SCENE_TOKENS.every((token) => a[token] === b[token])
}

/**
 * Re-reads tokens whenever the effective palette changes: the explicit toggle
 * (`data-theme` on the root), the OS-level preference, and the user's own
 * colour overrides — which App writes as inline custom properties on the same
 * element, hence `style` in the filter. Leave it out and the DOM recolours
 * while the 3D scene keeps the old palette.
 *
 * The equality check is not an optimisation, it is what makes watching `style`
 * affordable: `readTokens` builds a fresh object every time, so without it ANY
 * inline style written on the root — this app's or a browser extension's —
 * re-renders every material in the scene.
 */
export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(readTokens)

  useEffect(() => {
    const update = () =>
      setTokens((current) => {
        const next = readTokens()
        return sameTokens(current, next) ? current : next
      })

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style'],
    })

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)

    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])

  return tokens
}

/**
 * Tints the browser chrome to match the page. Read from the token rather than
 * a hex so tokens.css stays the one source of colour truth — and driven from
 * here rather than a pair of prefers-color-scheme <meta> variants, because
 * those follow the OS and would ignore an explicit in-app choice.
 */
function applyThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-background')
    .trim()
  if (color) meta.setAttribute('content', color)
}

/** Applies a theme preference to the document and remembers it. */
export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  applyThemeColor()
  try {
    window.localStorage.setItem('theme', theme)
  } catch {
    // Private browsing with storage disabled — the theme just won't persist.
  }
}
