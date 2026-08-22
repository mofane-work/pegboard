/**
 * User-defined custom components — placeholder bodies for the things that hang
 * on a real wall but are not SKÅDIS: a 3D-printed holder, an offcut, a router.
 *
 * These are a VISUALISATION AID ONLY. They carry no IKEA article number, are
 * never costed, and never travel in a share link (see findings F23).
 *
 * The whole design rests on one move: a `CustomPart` is converted into a
 * synthetic `AccessoryItem` and merged into the key -> item map. Snapping,
 * rotation, collision, the mesh builder and the pruning pass then need no
 * special cases at all — a custom part is just another accessory to them.
 *
 * Custom parts stay OUT of `CATALOG` and `ACCESSORIES`: `catalog.test.ts`
 * cross-checks that array against `data-raw/skadis-raw.json`, and a
 * user-invented item has nothing to check against.
 */

import { PITCH_MM, type Lattice, type PegPattern } from '../lib/grid'
import { BY_KEY, type AccessoryItem, type CatalogItem } from './catalog'

/**
 * The colon is load-bearing. `shareLink.ts` validates keys against
 * `/^[a-z0-9-]+$/`, so a custom key can never be mistaken for a catalog key —
 * and if one ever leaks into an encoder, the decoder rejects it loudly in tests
 * rather than handing a recipient an item they cannot resolve.
 */
export const CUSTOM_PREFIX = 'custom:'

export const MIN_CELLS = 1
export const MAX_CELLS = 8
export const MIN_DEPTH_MM = 10
export const MAX_DEPTH_MM = 400
export const MAX_NAME_LENGTH = 24
export const MAX_CUSTOM_PARTS = 12

export interface CustomPart {
  /** `custom:<id>` — see CUSTOM_PREFIX. */
  key: string
  name: string
  /** Width in peg cells, MIN_CELLS..MAX_CELLS. */
  cols: number
  /** Height in peg cells, MIN_CELLS..MAX_CELLS. */
  rows: number
  /** Protrusion from the board face, millimetres. */
  depthMm: number
  /**
   * Which lattice the pegs mount on. All pegs sit on 40 mm centres so they are
   * always on ONE lattice by construction; this picks which.
   */
  lattice: Lattice
}

export function isCustomKey(key: string): boolean {
  return key.startsWith(CUSTOM_PREFIX)
}

let customSeq = 0

export function newCustomKey(): string {
  customSeq += 1
  return `${CUSTOM_PREFIX}${Date.now().toString(36)}${customSeq.toString(36)}`
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Clamps a part to the supported range. This runs in the STORE, not only in the
 * form: `migrate` is skipped entirely when the persisted version already
 * matches, so a hand-edited localStorage blob would otherwise reach the scene
 * with a 400-cell body.
 */
export function clampCustomPart(part: CustomPart): CustomPart {
  const name = part.name.trim().slice(0, MAX_NAME_LENGTH)
  return {
    key: part.key,
    name: name === '' ? 'Custom part' : name,
    cols: clampInt(part.cols, MIN_CELLS, MAX_CELLS, MIN_CELLS),
    rows: clampInt(part.rows, MIN_CELLS, MAX_CELLS, MIN_CELLS),
    depthMm: clampInt(part.depthMm, MIN_DEPTH_MM, MAX_DEPTH_MM, MIN_DEPTH_MM),
    lattice: part.lattice === 'B' ? 'B' : 'A',
  }
}

export function customWidthMm(part: CustomPart): number {
  return part.cols * PITCH_MM
}

export function customHeightMm(part: CustomPart): number {
  return part.rows * PITCH_MM
}

/**
 * Pegs along the top edge, at the first and last cell. Mirrors the `hanging()`
 * convention in catalog.ts: the body hangs below its peg row, centred on the
 * peg span. The -20 mm x offset is what centres a cell-aligned body over a peg
 * span that is one pitch shorter than the body is wide.
 */
export function customPattern(part: CustomPart): PegPattern {
  const widthMm = customWidthMm(part)
  const heightMm = customHeightMm(part)
  const pegSpanPitches = part.cols - 1
  const pegSpan = pegSpanPitches * PITCH_MM

  return {
    lattice: part.lattice,
    offsets: pegSpanPitches > 0 ? [[pegSpanPitches, 0] as const] : [],
    bodyOffset: [-(widthMm - pegSpan) / 2, -heightMm],
    bodySize: [widthMm, heightMm],
  }
}

/**
 * The adapter. Everything downstream consumes `AccessoryItem`, so producing one
 * is what makes a custom part placeable without touching grid, mesh or drag code.
 *
 * `names` is filled for all three languages with the single name the user typed:
 * `LocalizedNames` is a total record, and `item.names[language]` renders blank
 * for a missing locale.
 */
export function customToItem(part: CustomPart): AccessoryItem {
  return {
    kind: 'accessory',
    key: part.key,
    archetype: 'customBox',
    itemNos: {},
    packQty: 1,
    names: { en: part.name, ja: part.name, 'zh-Hant': part.name },
    dims: { w: customWidthMm(part), d: part.depthMm, h: customHeightMm(part) },
    placeable: true,
    pattern: customPattern(part),
    // The user stated these dimensions, so there is nothing estimated about them.
    patternEstimated: false,
    dimsVerified: true,
  }
}

/**
 * The catalog as the app should see it: real SKÅDIS plus this user's inventions.
 * Pass this wherever a `byKey` map is accepted.
 */
export function catalogWithCustom(
  parts: readonly CustomPart[],
): ReadonlyMap<string, CatalogItem> {
  if (parts.length === 0) return BY_KEY
  const merged = new Map<string, CatalogItem>(BY_KEY)
  for (const part of parts) merged.set(part.key, customToItem(part))
  return merged
}
