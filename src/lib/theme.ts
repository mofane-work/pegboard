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
  '--color-accent',
] as const

export type SceneToken = (typeof SCENE_TOKENS)[number]
export type ThemeTokens = Record<SceneToken, string>

function readTokens(): ThemeTokens {
  const styles = getComputedStyle(document.documentElement)
  const tokens = {} as ThemeTokens
  for (const token of SCENE_TOKENS) {
    tokens[token] = styles.getPropertyValue(token).trim() || '#888888'
  }
  return tokens
}

/**
 * Re-reads tokens whenever the theme changes — both the explicit toggle
 * (`data-theme` on the root) and the OS-level preference.
 */
export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(readTokens)

  useEffect(() => {
    const update = () => setTokens(readTokens())

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
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
