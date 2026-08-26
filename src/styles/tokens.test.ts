import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'


/**
 * The scene palette is a set of colours chosen *against each other*, and every
 * one of those relationships is invisible in a diff — a plausible-looking hex
 * can undo the whole thing. These are the relationships, as floors rather than
 * targets, so a future edit has to be deliberate about breaking one.
 *
 * The failure this was written after: `--selected-color` and
 * `--accessory-color` sat at 1.07 in dark mode. Both were perfectly visible on
 * the board, and a selected item still could not be picked out from its
 * neighbours, because they differed only in hue and not in brightness.
 */

// Read off disk rather than imported: vitest stubs CSS imports to an empty
// string, and `?raw` is stubbed along with them. Relative to the project root,
// which is where vitest runs — `process.cwd()` would need @types/node, which
// this tsconfig deliberately does not carry.
const CSS = readFileSync('src/styles/tokens.css', 'utf8')

/** The declarations inside one balanced `{ … }` block, by token name. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector)
  if (start === -1) throw new Error(`no block for ${selector}`)

  let depth = 0
  let end = start
  for (let i = CSS.indexOf('{', start); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++
    if (CSS[i] === '}') depth--
    if (depth === 0) {
      end = i
      break
    }
  }

  const out: Record<string, string> = {}
  for (const [, name, value] of CSS.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[name] = value.trim()
  }
  return out
}

const LIGHT = block(':root {')
const DARK = block(":root[data-theme='dark']")
const DARK_MEDIA = block(":root:not([data-theme='light'])")

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const SCENE_TOKENS = [
  '--scene-bg',
  '--board-color',
  '--accessory-color',
  '--snap-ok',
  '--snap-bad',
  '--selected-color',
] as const

describe('the two dark palettes', () => {
  // They are written out twice by hand — one for the OS preference, one for the
  // explicit toggle — so they can drift, and the toggle would then disagree
  // with the exact same theme arrived at the other way.
  it('agree on every scene colour', () => {
    for (const token of SCENE_TOKENS) {
      expect(`${token}=${DARK_MEDIA[token]}`).toBe(`${token}=${DARK[token]}`)
    }
  })
})

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s scene palette', (_name, palette) => {
  it('defines every scene colour as a six-digit hex', () => {
    for (const token of SCENE_TOKENS) {
      expect(palette[token]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('separates a selected component from an ordinary one by brightness, not only hue', () => {
    // 1.07 shipped once and was the bug. Two colours of the same luminance read
    // as one tone under 3D lighting however different their hues are.
    expect(contrast(palette['--selected-color'], palette['--accessory-color'])).toBeGreaterThan(1.5)
  })

  it('keeps a selected accessory legible against the board', () => {
    expect(contrast(palette['--selected-color'], palette['--board-color'])).toBeGreaterThan(3)
  })

  it('keeps the legal/illegal drop colours apart from each other', () => {
    // These two mean "yes" and "no". They are the only feedback a drag has.
    expect(contrast(palette['--snap-ok'], palette['--snap-bad'])).toBeGreaterThan(1.4)
  })
})

// Asserted for dark only, and the reason is worth writing down rather than
// rediscovering: LIGHT's own accessory-on-board contrast is about 1.35, carried
// entirely by hue, shading and the cast shadow rather than by luminance. It is
// not a floor anything currently meets, so raising dark to meet light is
// impossible and lowering dark to match light would assert nothing. If light
// mode is ever reported as hard to read, that 1.35 is the number to go at.
describe('dark scene palette', () => {
  it('lifts the board clear of the void behind it', () => {
    // Dark mode has no ambient page light to separate these two.
    expect(contrast(DARK['--board-color'], DARK['--scene-bg'])).toBeGreaterThan(2.4)
  })

  it('keeps an accessory legible on the board', () => {
    expect(contrast(DARK['--accessory-color'], DARK['--board-color'])).toBeGreaterThan(3)
  })
})
