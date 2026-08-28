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
 *
 * A part also carries a `PegSpec` — the mirror of a board's `HoleGrid`, so the
 * two halves of the system are described in the same vocabulary and can be
 * checked against each other (findings F40).
 */

import {
  MAX_PITCH_MM,
  MIN_PITCH_MM,
  SKADIS_PEGS,
  type HoleGrid,
  type HoleShape,
  type Lattice,
  type PegLayout,
  type PegPattern,
  type PegSpec,
} from '../lib/grid'
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

export const MIN_PEG_MM = 1
export const MIN_PEG_LENGTH_MM = 1
/** Deep enough for any panel `MAX_THICKNESS_MM` allows, plus a retainer. */
export const MAX_PEG_LENGTH_MM = 60

export const PEG_LAYOUTS: readonly PegLayout[] = ['ends', 'every', 'single', 'corners']
const PEG_SHAPES: readonly HoleShape[] = ['slot-v', 'slot-h', 'round', 'square']

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
   * Which lattice the pegs mount on. Every peg of one part sits on that part's
   * own pitch, so they are always on ONE lattice by construction; this picks
   * which. Vacuous on an `aligned` board, which has only lattice A — see
   * `snapPlacement` (findings F39e).
   */
  lattice: Lattice
  /** The pegs themselves. Defaults to `SKADIS_PEGS`. */
  pegs: PegSpec
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

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  // Two decimals, because an inch converts to 25.4 and a quarter inch to 6.35.
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100))
}

/**
 * Bring a peg spec inside every limit. Mirrors `clampCustomBoard`'s treatment
 * of a `HoleGrid`, including the derived ceiling: a peg wider than its own
 * pitch could not be threaded between its neighbours.
 */
export function clampPegSpec(pegs: PegSpec | undefined): PegSpec {
  const source = pegs ?? SKADIS_PEGS
  const pitchMm = clampNumber(source.pitchMm, MIN_PITCH_MM, MAX_PITCH_MM, SKADIS_PEGS.pitchMm)
  const maxPeg = Math.max(MIN_PEG_MM, Math.round(pitchMm * 90) / 100)
  const widthMm = clampNumber(source.widthMm, MIN_PEG_MM, maxPeg, SKADIS_PEGS.widthMm)

  return {
    pitchMm,
    layout: PEG_LAYOUTS.includes(source.layout) ? source.layout : SKADIS_PEGS.layout,
    shape: PEG_SHAPES.includes(source.shape) ? source.shape : SKADIS_PEGS.shape,
    widthMm,
    // Falls back to the width, so a square-ish peg needs only one number.
    heightMm: clampNumber(source.heightMm, MIN_PEG_MM, maxPeg, widthMm),
    lengthMm: clampNumber(
      source.lengthMm,
      MIN_PEG_LENGTH_MM,
      MAX_PEG_LENGTH_MM,
      SKADIS_PEGS.lengthMm,
    ),
  }
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
    pegs: clampPegSpec(part.pegs),
  }
}

/**
 * One body cell is one pitch. The pitch is the PART's, not the board's: peg
 * offsets are lattice steps and always land on real holes, so this is the one
 * number that decides how big the part is drawn, and a mismatch with the board
 * under it is meant to be visible (findings F40).
 */
export function customWidthMm(part: CustomPart): number {
  return part.cols * part.pegs.pitchMm
}

export function customHeightMm(part: CustomPart): number {
  return part.rows * part.pegs.pitchMm
}

/**
 * Which cells carry a peg, as lattice steps from the anchor. `[0, 0]` is
 * implicit in `PegPattern`, so it is never listed here.
 *
 * The anchor is the body's TOP-LEFT cell and rows count upward, which is why
 * the second row of `corners` is at `-rows`: the body hangs down from its pegs,
 * so its bottom edge is exactly `rows` steps below them.
 */
export function pegOffsets(part: CustomPart): Array<readonly [number, number]> {
  const span = part.cols - 1

  switch (part.pegs.layout) {
    case 'single':
      return []

    case 'every': {
      const offsets: Array<readonly [number, number]> = []
      for (let col = 1; col <= span; col += 1) offsets.push([col, 0] as const)
      return offsets
    }

    case 'corners': {
      const offsets: Array<readonly [number, number]> = []
      if (span > 0) offsets.push([span, 0] as const)
      offsets.push([0, -part.rows] as const)
      if (span > 0) offsets.push([span, -part.rows] as const)
      return offsets
    }

    case 'ends':
    default:
      return span > 0 ? [[span, 0] as const] : []
  }
}

/**
 * Pegs along the top edge. Mirrors the `hanging()` convention in catalog.ts:
 * the body hangs below its peg row, centred on the peg span. A `single` layout
 * has no span, so the body centres on the one peg instead.
 */
export function customPattern(part: CustomPart): PegPattern {
  const widthMm = customWidthMm(part)
  const heightMm = customHeightMm(part)
  const pegSpan = part.pegs.layout === 'single' ? 0 : (part.cols - 1) * part.pegs.pitchMm

  return {
    lattice: part.lattice,
    offsets: pegOffsets(part),
    bodyOffset: [-(widthMm - pegSpan) / 2 || 0, -heightMm],
    bodySize: [widthMm, heightMm],
  }
}

/**
 * A hole or a peg reduced to the rectangle that has to pass through the other.
 * `round` and `square` are sized by their width alone; `slot-h` is a `slot-v`
 * on its side. One rule, applied to both sides of the comparison.
 */
function crossSection(shape: HoleShape, widthMm: number, heightMm: number): [number, number] {
  switch (shape) {
    case 'round':
    case 'square':
      return [widthMm, widthMm]
    case 'slot-h':
      return [heightMm, widthMm]
    default:
      return [widthMm, heightMm]
  }
}

/** Whether this peg could physically enter a hole in this grid. */
export function pegFitsHole(pegs: PegSpec, grid: HoleGrid): boolean {
  const [pegW, pegH] = crossSection(pegs.shape, pegs.widthMm, pegs.heightMm)
  const [holeW, holeH] = crossSection(grid.shape, grid.holeWidthMm, grid.holeHeightMm)
  return pegW <= holeW + 1e-9 && pegH <= holeH + 1e-9
}

/** Which of the three physical checks this part fails. */
export type PegWarning = 'pitch' | 'size' | 'length'

/**
 * Check a part against the grids actually on the wall.
 *
 * A part is only reported as wrong when it fits NONE of them — a wall may
 * legitimately mix a SKÅDIS panel with a 1-inch hardboard sheet, and a part
 * that suits one of them is not a mistake. With no boards to compare against
 * there is nothing to say, so this stays quiet rather than guessing.
 *
 * Every one of these is advice, not a veto: the part still places. The app has
 * always let a user draw something it believes cannot be built (findings F39).
 */
export function pegFitWarnings(part: CustomPart, grids: readonly HoleGrid[]): PegWarning[] {
  if (grids.length === 0) return []

  const warnings: PegWarning[] = []
  if (!grids.some((g) => Math.abs(g.pitchMm - part.pegs.pitchMm) < 0.01)) warnings.push('pitch')
  if (!grids.some((g) => pegFitsHole(part.pegs, g))) warnings.push('size')
  if (!grids.some((g) => part.pegs.lengthMm >= g.thicknessMm)) warnings.push('length')
  return warnings
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
    pegs: part.pegs,
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
